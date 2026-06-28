// 消息处理逻辑 —— 管理员过滤、命令响应、自动回复（支持 AI 回复）

const { loadConfig } = require('./config');
const { addMessage, getMessages } = require('./message-store');
const ai = require('./ai');
const conversationStore = require('./conversation-store');

function extractReplyMessageId(msg) {
  const match = String(msg || '').match(/\[CQ:reply,id=([^\],]+)[^\]]*\]/);
  return match ? match[1] : null;
}

function extractAtUserIds(msg) {
  const ids = [];
  const re = /\[CQ:at,qq=([^,\]]+)[^\]]*\]/g;
  let match;
  while ((match = re.exec(String(msg || ''))) !== null) {
    const id = Number(match[1]);
    if (Number.isFinite(id)) ids.push(id);
  }
  return [...new Set(ids)];
}

function formatSender(sender = {}, fallbackUserId = '') {
  return sender.card || sender.nickname || sender.user_id || fallbackUserId || '未知用户';
}

function getEventSenderName(event) {
  const sender = event?.sender || {};
  return formatSender(sender, event?.user_id || '未知用户');
}

function parseAiReplyDirective(text) {
  const raw = String(text || '').trim();
  const match = raw.match(/^引用消息ID[:：]\s*(\d+)\s*\n+/);
  if (!match) return { text: raw, replyMessageId: null };
  return {
    replyMessageId: Number(match[1]),
    text: raw.slice(match[0].length).trim(),
  };
}

function isKnownGroupMessageId(groupId, messageId) {
  if (!groupId || !messageId) return false;
  return getMessages(120, null, groupId)
    .some((m) => Number(m.message_id) === Number(messageId));
}

function userExplicitlyAskedForQuote(raw) {
  const text = ai.stripCqCodes(raw).trim();
  return /引用|回复|回一下|评价一下|点评一下|这条|那条|上面那/.test(text);
}

function userLikelyTargetsContextMessage(raw) {
  const text = ai.stripCqCodes(raw).trim();
  if (userExplicitlyAskedForQuote(raw)) return true;
  return /\bta\b|他|她|它|那个人|那位|刚才那/.test(text) && !/还有吗|继续说|展开|忘记/.test(text);
}

function buildGroupReplyMessage(event, cfg, text, aiSelectedMessageId = null) {
  if (!event?.group_id || cfg.ai_group_reply_quote_enabled !== true) return text;
  const currentMessageId = event.message_id;
  if (!currentMessageId) return text;

  const quotedMessageId = cfg.ai_group_reply_quote_prefer_quoted !== false
    ? extractReplyMessageId(event.raw_message || '')
    : null;
  const modelSelectedId = (
    userLikelyTargetsContextMessage(event.raw_message || '') &&
    isKnownGroupMessageId(event.group_id, aiSelectedMessageId)
  )
    ? aiSelectedMessageId
    : null;

  // 用户明确要求引用/回复某条上文时，如果模型没选出 ID，不要退回引用当前 @Bot 消息。
  // 否则看起来像“引用错了”。这种情况直接普通回复更安全。
  if (!modelSelectedId && !quotedMessageId && userExplicitlyAskedForQuote(event.raw_message || '')) {
    console.warn('[BotCore] 用户要求引用，但模型没有选择有效消息ID，改为普通回复');
    return text;
  }

  const targetMessageId = modelSelectedId || quotedMessageId;
  if (!targetMessageId) return text;
  console.log(`[BotCore] 群聊回复引用 message_id=${targetMessageId}`);

  // 只发送 reply CQ，不追加 [CQ:at]，避免 QQ 里产生很吵的 @ 提醒。
  return `[CQ:reply,id=${targetMessageId}]${text}`;
}

function summarizeRawMessage(raw) {
  const text = ai.stripCqCodes(raw);
  const tags = [];
  if (/\[CQ:image,/.test(String(raw || ''))) tags.push('[图片]');
  if (/\[CQ:record,/.test(String(raw || ''))) tags.push('[语音]');
  if (/\[CQ:video,/.test(String(raw || ''))) tags.push('[视频]');
  if (/\[CQ:file,/.test(String(raw || ''))) tags.push('[文件]');
  return [text, ...tags].filter(Boolean).join(' ').trim() || '[非文本消息]';
}

function isCommandContextMessage(raw, prefix = '/') {
  const text = ai.stripCqCodes(raw).trim();
  if (!text) return false;
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const commandRe = new RegExp(`^${escapedPrefix}(ping|status|help|clearcontext|clearctx)(\\s|$)`, 'i');
  return (
    commandRe.test(text) ||
    /^命令列表[:：]/.test(text) ||
    /\/clearcontext\s*-\s*清空当前/.test(text) ||
    /\/ping\s*-\s*测试/.test(text)
  );
}

function formatTime(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

function roleLabel(role) {
  if (role === 'owner') return '群主';
  if (role === 'admin') return '管理员';
  if (role === 'member') return '普通群员';
  return '未知';
}

function canManageRole(botRole, targetRole) {
  if (!['owner', 'admin'].includes(botRole)) return false;
  if (targetRole === 'owner') return false;
  if (targetRole === 'admin' && botRole !== 'owner') return false;
  return true;
}

async function getMemberRole(client, groupId, userId) {
  if (!client?.getGroupMemberInfo || !groupId || !userId) return 'unknown';
  const result = await client.getGroupMemberInfo(groupId, userId, true);
  return result?.status === 'ok' ? (result.data?.role || 'unknown') : 'unknown';
}

function buildGroupManagementFunctionDeclarations(options = {}) {
  const declarations = [];
  if (options.memberListEnabled) {
    declarations.push({
      name: 'qq_get_group_members',
      description: '获取当前 QQ 群所有群成员的 QQ 号、昵称、群名片和身份。用于查找用户提到的成员，或回答当前群成员列表相关问题。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '可选。按昵称、群名片或 QQ 号过滤成员；不填则返回当前群全部成员' },
        },
      },
    });
  }

  if (!options.managementEnabled) return declarations;

  declarations.push(
    {
      name: 'qq_mute_member',
      description: '禁言当前 QQ 群中的某个成员。只在 bot 是管理员或群主，且触发者有权限时可执行。',
      parameters: {
        type: 'object',
        properties: {
          target_user_id: { type: 'integer', description: '要禁言的目标 QQ 号' },
          duration_seconds: { type: 'integer', description: '禁言秒数。未说明时用 600 秒，最长 2592000 秒' },
          reason: { type: 'string', description: '简短原因' },
        },
        required: ['target_user_id'],
      },
    },
    {
      name: 'qq_unmute_member',
      description: '解除当前 QQ 群中某个成员的禁言',
      parameters: {
        type: 'object',
        properties: {
          target_user_id: { type: 'integer', description: '要解除禁言的目标 QQ 号' },
          reason: { type: 'string', description: '简短原因' },
        },
        required: ['target_user_id'],
      },
    },
    {
      name: 'qq_kick_member',
      description: '把当前 QQ 群中的某个成员移出群。只有用户明确要求踢人/移出群时才使用',
      parameters: {
        type: 'object',
        properties: {
          target_user_id: { type: 'integer', description: '要踢出的目标 QQ 号' },
          reject_add_request: { type: 'boolean', description: '是否拒绝此人后续加群请求，默认 false' },
          reason: { type: 'string', description: '简短原因' },
        },
        required: ['target_user_id'],
      },
    }
  );

  return declarations;
}

async function executeGroupManagementTool(name, args, context) {
  const { event, client, cfg, botRole, requesterIsAdmin } = context;
  const groupId = event.group_id;
  const targetUserId = Number(args?.target_user_id || 0);

  function deny(message) {
    return { ok: false, message };
  }

  if (!groupId) return deny('这个工具只能在群聊里用');
  if (!requesterIsAdmin) return deny('你没有权限让我读取群成员列表或执行群管理操作');

  if (name === 'qq_get_group_members') {
    if (!client?.getGroupMemberList) return deny('当前 OneBot 客户端不支持读取群成员列表');
    const result = await client.getGroupMemberList(groupId);
    if (result?.status !== 'ok' || !Array.isArray(result.data)) {
      return deny(`获取群成员列表失败：${result?.wording || result?.msg || '未知错误'}`);
    }
    const keyword = String(args?.keyword || '').trim().toLowerCase();
    const members = result.data
      .map((m) => ({
        user_id: Number(m.user_id),
        nickname: m.nickname || '',
        card: m.card || '',
        display_name: m.card || m.nickname || String(m.user_id),
        role: m.role || 'unknown',
        title: m.title || '',
      }))
      .filter((m) => !keyword || [
        String(m.user_id),
        m.nickname,
        m.card,
        m.display_name,
        m.title,
      ].some((value) => String(value || '').toLowerCase().includes(keyword)));
    return {
      ok: true,
      action: 'get_group_members',
      group_id: groupId,
      total_count: result.data.length,
      returned_count: members.length,
      members,
      message: keyword
        ? `找到 ${members.length} 个匹配成员`
        : `当前群共有 ${result.data.length} 个成员`,
    };
  }

  if (!['owner', 'admin'].includes(botRole)) {
    return deny(`我在这个群只是${roleLabel(botRole)}，没有群管理权限`);
  }
  if (!targetUserId) return deny('没找到要操作的目标 QQ');
  if (targetUserId === Number(event.self_id)) return deny('不能操作我自己');
  if ((cfg.admins || []).map(Number).includes(targetUserId)) return deny('不能操作配置里的管理员');

  const targetRole = await getMemberRole(client, groupId, targetUserId);
  if (!canManageRole(botRole, targetRole)) {
    return deny(`我目前是${roleLabel(botRole)}，不能操作对方这个身份：${roleLabel(targetRole)}`);
  }

  if (name === 'qq_mute_member') {
    const duration = Math.max(60, Math.min(2592000, Number(args?.duration_seconds || 600)));
    const result = await client.setGroupBan(groupId, targetUserId, duration);
    const ok = result?.status === 'ok';
    return {
      ok,
      action: 'mute',
      target_user_id: targetUserId,
      duration_seconds: duration,
      message: ok ? `已禁言 ${targetUserId} ${duration} 秒` : `禁言失败：${result?.wording || result?.msg || '未知错误'}`,
    };
  }

  if (name === 'qq_unmute_member') {
    const result = await client.setGroupBan(groupId, targetUserId, 0);
    const ok = result?.status === 'ok';
    return {
      ok,
      action: 'unmute',
      target_user_id: targetUserId,
      message: ok ? `已解除 ${targetUserId} 的禁言` : `解除禁言失败：${result?.wording || result?.msg || '未知错误'}`,
    };
  }

  if (name === 'qq_kick_member') {
    const reject = args?.reject_add_request === true;
    const result = await client.setGroupKick(groupId, targetUserId, reject);
    const ok = result?.status === 'ok';
    return {
      ok,
      action: 'kick',
      target_user_id: targetUserId,
      reject_add_request: reject,
      message: ok ? `已移出 ${targetUserId}` : `移出失败：${result?.wording || result?.msg || '未知错误'}`,
    };
  }

  return deny(`未知工具：${name}`);
}

async function buildQuotedMessageContext(event, client, cfg) {
  if (!cfg.ai_group_context_include_quote) return '';
  const replyId = extractReplyMessageId(event.raw_message || '');
  if (!replyId || !client?.getMsg) return '';

  const result = await client.getMsg(replyId);
  if (!result || result.status !== 'ok' || !result.data) return '';

  const data = result.data;
  const senderName = formatSender(data.sender || {}, data.user_id);
  const raw = data.raw_message || String(data.message || '');
  const summary = summarizeRawMessage(raw);
  if (cfg.ai_filter_stickers !== false && ai.isStickerMessage(raw)) {
    return '';
  }

  // 如果引用消息本身带图，把原 CQ:image 保留在这一段里，ai.js 会提取图片并作为 inline_data 发送。
  const imagePart = /\[CQ:image,/.test(raw) ? `\n引用消息原始图片：${raw}` : '';
  return `重点引用消息：\n消息ID=${replyId} ${senderName}：${summary}${imagePart}`;
}

async function buildMentionedMembersContext(event, client) {
  if (!event.group_id) return '';
  const selfId = Number(event.self_id || 0);
  const ids = extractAtUserIds(event.raw_message || '')
    .filter((id) => id && id !== selfId)
    .slice(0, 5);
  if (!ids.length) return '';

  const lines = [];
  for (const id of ids) {
    const result = client?.getGroupMemberInfo
      ? await client.getGroupMemberInfo(event.group_id, id, true)
      : null;
    if (result?.status === 'ok' && result.data) {
      const name = formatSender(result.data.sender || result.data, id);
      lines.push(`QQ=${id} ${name} 身份=${roleLabel(result.data.role || 'unknown')}`);
    } else {
      lines.push(`QQ=${id}`);
    }
  }
  return `当前消息额外 @ 到的群成员（通常就是用户要求操作/询问的对象）：\n${lines.join('\n')}`;
}

async function buildRecentGroupContext(event, client, cfg) {
  if (!cfg.ai_group_context_enabled || !event.group_id) return '';
  const limit = Math.max(1, Math.min(50, Number(cfg.ai_group_context_messages || 20)));
  const messages = getMessages(limit + 12, null, event.group_id)
    .filter((m) => m.message_id !== event.message_id)
    .filter((m) => !(cfg.ai_group_context_exclude_bot && m.user_id === event.self_id))
    .filter((m) => !(cfg.ai_filter_stickers !== false && ai.isStickerMessage(m.raw_message)))
    .filter((m) => !isCommandContextMessage(m.raw_message, cfg.command_prefix || '/'))
    .slice(0, limit)
    .reverse();

  if (!messages.length) return '';

  const lines = [];
  let resolvedReplyCount = 0;
  for (const m of messages) {
    const time = formatTime(m.time);
    const name = m.group_name || m.nickname || String(m.user_id || '未知用户');
    const raw = String(m.raw_message || '');
    const text = summarizeRawMessage(raw).slice(0, 300);
    const line = `[${time}] 消息ID=${m.message_id} QQ=${m.user_id} ${name}：${text}`;
    lines.push(line);

    // 普通图片要把原始 CQ 码也带给 ai.js，后者会提取 URL 并转成 Gemini inline_data。
    // 表情包已在上面的 filter 中跳过，不会走到这里。
    if (/\[CQ:image,/.test(raw) && !ai.isStickerMessage(raw)) {
      lines.push(`该消息图片原始：${raw}`);
    }

    // 历史聊天里有人“引用了一条图片消息”时，当前消息本身只有 [CQ:reply]，图片在被引用消息里。
    // 这里少量解析最近的引用消息，避免用户稍后 @Bot 时看不到被引用图片。
    const replyId = extractReplyMessageId(raw);
    if (replyId && client?.getMsg && cfg.ai_group_context_include_quote && resolvedReplyCount < 5) {
      const result = await client.getMsg(replyId);
      const quotedRaw = result?.status === 'ok'
        ? (result.data?.raw_message || String(result.data?.message || ''))
        : '';
      if (quotedRaw && !(cfg.ai_filter_stickers !== false && ai.isStickerMessage(quotedRaw))) {
        const quotedSender = formatSender(result.data?.sender || {}, result.data?.user_id);
        lines.push(`该消息引用：消息ID=${replyId} ${quotedSender}：${summarizeRawMessage(quotedRaw).slice(0, 300)}`);
        if (/\[CQ:image,/.test(quotedRaw) && !ai.isStickerMessage(quotedRaw)) {
          lines.push(`引用图片原始：${quotedRaw}`);
        }
        resolvedReplyCount += 1;
      }
    }
  }

  return `最近群聊消息：\n${lines.join('\n')}`;
}

async function buildGroupAwarePrompt(event, client, cfg, currentMsg, managementContext = null) {
  if (!event.group_id || !cfg.ai_group_context_enabled) return currentMsg;

  const sections = [
    '以下是当前 QQ 群聊上下文，仅用于理解用户这次 @Bot 的问题。不要主动复述上下文；如果上下文不足，再简短追问。最近群聊消息里带有“消息ID=数字”和“QQ=数字”。只有当用户明确要求引用、回复、评价某个人/某条消息，或问题里明显用“他/她/那条/上面那条”指向某条上文时，才选择消息ID，并在最终回复第一行输出“引用消息ID：数字”，第二行开始写正文。普通追问、继续、还有吗、闲聊时不要输出引用消息ID。这个标记是给系统看的，不要解释。',
  ];

  if (managementContext) {
    sections.push(
      `当前触发用户：${getEventSenderName(event)}，QQ=${event.user_id}，` +
      `${managementContext.requesterIsAdmin ? '是' : '不是'} bot 配置管理员。` +
      `我在本群的身份是${roleLabel(managementContext.botRole)}。` +
      `群管理工具${managementContext.toolsEnabled ? '可用' : '不可用'}。` +
      `群成员列表工具${managementContext.memberListEnabled ? '可用' : '不可用'}。` +
      '如果需要通过昵称、群名片或模糊称呼查 QQ 号，可以调用 qq_get_group_members；需要全部成员时不传 keyword，需要筛选时传 keyword。' +
      '只有用户明确要求禁言、解除禁言、踢出成员等群管理动作时才调用管理工具；不要因为普通争吵或玩笑自动管理。' +
      '如果当前消息额外 @ 了某个群成员，并且管理员要求禁言/解禁/踢出/封禁，优先把这个被 @ 的 QQ 作为 target_user_id。' +
      '调用工具时必须使用上下文里明确给出的 QQ 号作为 target_user_id，不要猜 QQ 号。'
    );
  }

  const mentionedMembers = await buildMentionedMembersContext(event, client);
  if (mentionedMembers) sections.push(mentionedMembers);

  const quoted = await buildQuotedMessageContext(event, client, cfg);
  if (quoted) sections.push(quoted);

  const recent = await buildRecentGroupContext(event, client, cfg);
  if (recent) sections.push(recent);

  sections.push(`当前用户消息：\n${currentMsg}`);
  return sections.join('\n\n');
}

/**
 * 处理 OneBot 事件（仅处理消息事件）。
 */
async function handleEvent(event, client) {
  if (event.post_type !== 'message') return;

  const cfg = loadConfig();
  const userId = event.user_id || 0;
  // raw_message 为纯文本，message 可能为数组格式
  let msg = event.raw_message || '';
  if (!msg) {
    const raw = event.message;
    if (typeof raw === 'string') {
      msg = raw;
    } else {
      msg = String(raw || '');
    }
  }
  const msgType = event.message_type || '';

  console.log(`[BotCore] 收到消息: [${msgType}] user=${userId} msg=${msg.slice(0, 50)}`);

  // 存储消息（供面板查看）
  addMessage(event);

  // 忽略自身消息
  if (userId === event.self_id) return;

  const groupId = event.group_id;
  const selfId = String(event.self_id || '');
  const isMentioned = groupId ? msg.includes(`[CQ:at,qq=${selfId}]`) : false;
  const prefix = cfg.command_prefix || '/';
  const isCommand = msg.startsWith(prefix);

  // 管理员始终可用；非管理员只在“群聊 + @bot + 面板开关开启 + 非命令”时允许触发 AI。
  const admins = cfg.admins || [];
  const isAdmin = admins.includes(userId);
  const allowGroupMentionFromNonAdmin =
    groupId &&
    isMentioned &&
    !isCommand &&
    cfg.ai_allow_group_mention_from_non_admin === true;
  if (!isAdmin && !allowGroupMentionFromNonAdmin) return;

  // 群白名单检查（私聊不受限制；非管理员 @bot 也必须受白名单限制）
  if (groupId && cfg.group_filter_enabled) {
    const activeGroups = cfg.active_groups || [];
    if (activeGroups.length > 0 && !activeGroups.includes(groupId)) {
      return; // 不在白名单群里，忽略
    }
  }

  // 命令处理（非管理员命令在前面的权限检查中已经被拦截）
  if (isCommand) {
    await handleCommand(msg.slice(prefix.length), event, client, cfg);
    return;
  }

  // AI 自动回复
  // 群消息：只有 @bot 才进入；私聊：直接进入。
  if (groupId && !isMentioned) return;

  // AI 未启用或未配置 API Key 时直接不回复。
  if (cfg.ai_enabled !== true || !String(cfg.ai_api_key || '').trim()) return;

  // 只有表情包/动画表情时默认不触发 AI，避免把群聊斗图当成问题处理。
  if (cfg.ai_filter_stickers !== false && ai.isStickerMessage(msg) && !ai.stripCqCodes(msg)) return;

  // 去掉 CQ 码，避免污染 AI 上下文。图片本体会在 ai.js 中单独解析并发送给 Gemini。
  let cleanMsg = ai.stripCqCodes(msg);
  if (!cleanMsg) cleanMsg = /\[CQ:image,/.test(msg) ? '[图片]' : '你好';

  const conversationKey = conversationStore.getConversationKey(event);
  const contextTurns = Math.max(1, Number(cfg.ai_context_turns || 10));
  const history = cfg.ai_context_enabled
    ? conversationStore.getHistory(conversationKey, contextTurns * 2)
    : [];

  const botRole = groupId
    ? await getMemberRole(client, groupId, event.self_id)
    : 'none';
  const managementToolsEnabled = Boolean(
    groupId &&
    isAdmin &&
    ['owner', 'admin'].includes(botRole)
  );
  const memberListToolsEnabled = Boolean(groupId && isAdmin);
  const managementContext = groupId
    ? {
      botRole,
      toolsEnabled: managementToolsEnabled,
      memberListEnabled: memberListToolsEnabled,
      requesterIsAdmin: isAdmin,
    }
    : null;

  const aiInput = await buildGroupAwarePrompt(event, client, cfg, msg, managementContext);
  const functionDeclarations = buildGroupManagementFunctionDeclarations({
    memberListEnabled: memberListToolsEnabled,
    managementEnabled: managementToolsEnabled,
  });

  let aiReply;
  try {
    aiReply = await ai.chat(aiInput, history, cfg, {
      functionDeclarations,
      executeFunctionCall: (name, args) => executeGroupManagementTool(name, args, {
        event,
        client,
        cfg,
        botRole,
        requesterIsAdmin: isAdmin,
      }),
    });
  } catch (err) {
    console.error('[BotCore] AI 回复失败:', err);
    return;
  }

  if (!aiReply) return;

  const parsedReply = parseAiReplyDirective(aiReply);
  if (groupId && parsedReply.replyMessageId) {
    console.log(`[BotCore] 模型选择引用 message_id=${parsedReply.replyMessageId}`);
  }
  aiReply = parsedReply.text;
  if (!aiReply) return;

  const historyUserText = groupId
    ? `${getEventSenderName(event)} 问：${cleanMsg}`
    : cleanMsg;
  const historyAssistantText = groupId
    ? `Bot 回复 ${getEventSenderName(event)}：${aiReply}`
    : aiReply;
  conversationStore.appendTurn(conversationKey, historyUserText, historyAssistantText, contextTurns);

  if (groupId) {
    await client.sendGroupMsg(groupId, buildGroupReplyMessage(event, cfg, aiReply, parsedReply.replyMessageId));
  } else {
    await client.sendPrivateMsg(userId, aiReply);
  }
}

/**
 * 处理管理员命令。
 */
async function handleCommand(cmd, event, client, _cfg) {
  const userId = event.user_id;
  const groupId = event.group_id;

  async function reply(text) {
    if (groupId) {
      await client.sendGroupMsg(groupId, text);
    } else {
      await client.sendPrivateMsg(userId, text);
    }
  }

  cmd = cmd.trim();
  if (!cmd) return;
  const parts = cmd.split(/\s+/);
  const name = parts[0].toLowerCase();

  if (name === 'ping') {
    await reply('pong! 🏓');
  } else if (name === 'status') {
    const info = await client.getLoginInfo();
    const data = (info && info.data) || {};
    await reply(
      'Bot 运行中\n' +
      `QQ: ${data.user_id}\n` +
      `昵称: ${data.nickname}\n` +
      `连接: ${client.connected ? '✅ 在线' : '❌ 离线'}`
    );
  } else if (name === 'clearcontext' || name === 'clearctx') {
    const key = conversationStore.getConversationKey(event);
    conversationStore.clearHistory(key);
    await reply('已清空当前上下文');
  } else if (name === 'help') {
    await reply(
      '命令列表:\n' +
      '/ping - 测试\n' +
      '/status - 状态\n' +
      '/clearcontext - 清空当前会话上下文\n' +
      '/clearctx - 清空当前会话上下文\n' +
      '/help - 帮助'
    );
  } else {
    await reply(`未知命令: ${name}\n发送 /help 查看帮助`);
  }
}

module.exports = { handleEvent, handleCommand };
