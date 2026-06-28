// 消息处理逻辑 —— 管理员过滤、命令响应、自动回复（支持 AI 回复）

const { loadConfig } = require('./config');
const { addMessage, getMessages, searchMessages } = require('./message-store');
const ai = require('./ai');
const conversationStore = require('./conversation-store');
const memoryStore = require('./memory-store');

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

function annotateAtMentions(raw, selfId = null) {
  return String(raw || '').replace(/\[CQ:at,qq=([^,\]]+)[^\]]*\]/g, (_, qq) => {
    const id = Number(qq);
    if (selfId && id === Number(selfId)) return '@Bot';
    return `@QQ=${qq}`;
  });
}

function isBotMentionedRaw(raw, selfId) {
  return Boolean(selfId) && String(raw || '').includes(`[CQ:at,qq=${selfId}]`);
}

function isOnlyBotMentionMessage(raw, selfId) {
  if (!isBotMentionedRaw(raw, selfId)) return false;
  const text = ai.stripCqCodes(raw).trim();
  const hasMedia = /\[CQ:(image|record|video|file),/.test(String(raw || ''));
  const atIds = extractAtUserIds(raw);
  return !text && !hasMedia && atIds.length > 0 && atIds.every((id) => id === Number(selfId));
}

function formatSender(sender = {}, fallbackUserId = '') {
  return sender.card || sender.nickname || sender.user_id || fallbackUserId || '未知用户';
}

function getEventSenderName(event) {
  const sender = event?.sender || {};
  return formatSender(sender, event?.user_id || '未知用户');
}

function getCurrentHourText() {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}年${get('month')}月${get('day')}日的${get('hour')}点`;
}

function buildMemorySystemPrompt(conversationKey) {
  const mems = memoryStore.getForConversation(conversationKey);
  const currentHour = getCurrentHourText();
  const lines = [
    '## Memories',
    'These are memories that you can reference in the future conversations.',
    '<memories>',
  ];
  for (const m of mems) {
    lines.push('<record>');
    lines.push(`<id>${m.id}</id>`);
    lines.push(`<content>${m.content}</content>`);
    lines.push('</record>');
  }
  lines.push('</memories>');
  lines.push(`
## Memory Tool
你是一个无状态的大模型，你无法存储记忆，因此为了记住信息，你需要使用**记忆工具**。
你可以使用 \`create_memory\`, \`edit_memory\`, \`delete_memory\` 工具创建、更新或删除记忆。
- 如果记忆中没有相关信息，请使用 create_memory 创建一条新的记录。
- 如果已有相关记录，请使用 edit_memory 更新内容。
- 若记忆过时或无用，请使用 delete_memory 删除。
这些记忆会自动包含在未来的对话上下文中，在<memories>标签内。
请勿在记忆中存储敏感信息，敏感信息包括：用户的民族、宗教信仰、性取向、政治观点及党派归属、性生活、犯罪记录等。
在与用户聊天过程中，你可以像一个私人秘书一样**主动的**记录用户相关的信息到记忆里，包括但不限于：
- 用户昵称/姓名
- 年龄/性别/兴趣爱好
- 计划事项等
- 聊天风格偏好
- 工作相关
- 首次聊天时间
- ...
请主动调用工具记录，而不是需要用户要求。
记忆如果包含日期信息，请包含在内，请使用绝对时间格式，并且当前时间是${currentHour}。
无需告知用户你已更改记忆记录，也不要在对话中直接显示记忆内容，除非用户主动要求。
相似或相关的记忆应合并为一条记录，而不要重复记录，过时记录应删除。
你可以在和用户闲聊的时候暗示用户你能记住东西。
`);
  lines.push(`注意：这些记忆只属于当前 QQ 会话 ${conversationKey}，不要跨私聊或其他群聊使用。`);
  return lines.join('\n');
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

function summarizeRawMessage(raw, selfId = null) {
  const annotated = annotateAtMentions(raw, selfId);
  const text = ai.stripCqCodes(annotated);
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
  if (options.memoryEnabled) {
    declarations.push(
      {
        name: 'create_memory',
        description: 'create a memory record',
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'The content of the memory record' },
          },
          required: ['content'],
        },
      },
      {
        name: 'edit_memory',
        description: 'update a memory record',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'integer', description: 'The id of the memory record' },
            content: { type: 'string', description: 'The content of the memory record' },
          },
          required: ['id', 'content'],
        },
      },
      {
        name: 'delete_memory',
        description: 'delete a memory record',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'integer', description: 'The id of the memory record' },
          },
          required: ['id'],
        },
      }
    );
  }
  if (options.searchEnabled) {
    declarations.push({
      name: 'qq_search_chat_history',
      description: '像 grep 一样在当前 QQ 会话的持久化聊天记录里搜索。可按关键词、发言人 QQ、时间范围过滤，query 可以为空。用于任何需要回顾、查询、搜索、统计、分析聊天记录或核对上下文的请求，例如用户说“查一下/搜一下/回顾/统计/分析/谁说过/某人说了什么/我在本群的发言/最近聊到某话题”。只搜索当前群或当前私聊，不跨会话；提到“我/我的发言”时 user_id 应使用当前触发用户 QQ。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '可选。要搜索的关键词或短语；如果只想查某个 QQ 最近说了什么，可以不填 query，只传 user_id' },
          user_id: { type: 'integer', description: '可选。只返回这个 QQ 号发出的消息' },
          limit: { type: 'integer', description: '最多返回多少条，默认 10，最多 50' },
          regex: { type: 'boolean', description: '是否把 query 当正则表达式，默认 false' },
          from_time: { type: 'string', description: '可选。只搜索此时间之后的消息，ISO 时间字符串' },
          to_time: { type: 'string', description: '可选。只搜索此时间之前的消息，ISO 时间字符串' },
        },
      },
    });
  }
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
      name: 'qq_set_group_whole_ban',
      description: '开启或关闭当前 QQ 群的全员禁言。用户说“开启群禁言/全员禁言/全群禁言/关闭群禁言”时使用。',
      parameters: {
        type: 'object',
        properties: {
          enable: { type: 'boolean', description: 'true 开启全员禁言，false 关闭全员禁言' },
          reason: { type: 'string', description: '简短原因' },
        },
        required: ['enable'],
      },
    },
    {
      name: 'qq_mute_all_manageable_members',
      description: '批量禁言当前群里 bot 有权限操作的普通成员。用户说“把群里所有人都禁言/给所有人上X分钟”时使用；不要用于“开启全员禁言”这种群开关。',
      parameters: {
        type: 'object',
        properties: {
          duration_seconds: { type: 'integer', description: '禁言秒数。未说明时用 600 秒，最长 2592000 秒' },
          reason: { type: 'string', description: '简短原因' },
        },
      },
    },
    {
      name: 'qq_unmute_all_manageable_members',
      description: '批量解除当前群里 bot 有权限操作的普通成员禁言。用户说“把所有禁言都解开/给所有人解禁”时使用。',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: '简短原因' },
        },
      },
    },
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

async function getManageableMembers(client, groupId, cfg, event, botRole) {
  const result = await client.getGroupMemberList(groupId);
  if (result?.status !== 'ok' || !Array.isArray(result.data)) {
    return {
      ok: false,
      message: `获取群成员列表失败：${result?.wording || result?.msg || '未知错误'}`,
      members: [],
    };
  }

  const adminSet = new Set((cfg.admins || []).map(Number));
  const members = result.data
    .map((m) => ({
      user_id: Number(m.user_id),
      nickname: m.nickname || '',
      card: m.card || '',
      display_name: m.card || m.nickname || String(m.user_id),
      role: m.role || 'unknown',
    }))
    .filter((m) => m.user_id && m.user_id !== Number(event.self_id))
    .filter((m) => !adminSet.has(m.user_id))
    .filter((m) => canManageRole(botRole, m.role));
  return { ok: true, total_count: result.data.length, members };
}

function executeMemoryTool(name, args, conversationKey, cfg) {
  if (cfg.ai_memory_enabled !== true) {
    return { ok: false, message: '记忆功能未启用' };
  }
  if (name === 'create_memory') {
    const content = String(args?.content || '').trim();
    if (!content) return { ok: false, message: 'Memory content must not be empty.' };
    const memory = memoryStore.add(conversationKey, content);
    return memory
      ? { ok: true, action: 'create_memory', id: memory.id, content: memory.content, message: memory.content }
      : { ok: false, message: '创建记忆失败' };
  }
  if (name === 'edit_memory') {
    const id = Number(args?.id || 0);
    const content = String(args?.content || '').trim();
    if (!id) return { ok: false, message: 'Memory id must be a positive integer.' };
    if (!content) return { ok: false, message: 'Memory content must not be empty.' };
    const memory = memoryStore.update(conversationKey, id, content);
    return memory
      ? { ok: true, action: 'edit_memory', id: memory.id, content: memory.content, message: memory.content }
      : { ok: false, message: `No memory record was found for id ${id}.` };
  }
  if (name === 'delete_memory') {
    const id = Number(args?.id || 0);
    if (!id) return { ok: false, message: 'Memory id must be a positive integer.' };
    const ok = memoryStore.remove(conversationKey, id);
    return ok
      ? { ok: true, action: 'delete_memory', id, message: 'deleted' }
      : { ok: false, message: `No memory record was found for id ${id}.` };
  }
  return null;
}

async function executeGroupManagementTool(name, args, context) {
  const { event, client, cfg, botRole, requesterIsAdmin } = context;
  const groupId = event.group_id;
  const targetUserId = Number(args?.target_user_id || 0);

  if (name === 'create_memory' || name === 'edit_memory' || name === 'delete_memory') {
    const conversationKey = conversationStore.getConversationKey(event);
    return executeMemoryTool(name, args, conversationKey, cfg);
  }

  if (name === 'qq_search_chat_history') {
    const result = searchMessages({
      query: args?.query || '',
      userId: args?.user_id,
      limit: Math.max(1, Math.min(50, Number(args?.limit || 10))),
      regex: args?.regex === true,
      fromTime: args?.from_time,
      toTime: args?.to_time,
      groupId: groupId || null,
      privateUserId: groupId ? null : event.user_id,
    });
    return {
      ok: true,
      action: 'search_chat_history',
      ...result,
      message: result.total > 0
        ? `找到 ${result.total} 条相关聊天记录`
        : '没搜到相关聊天记录',
    };
  }

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

  if (name === 'qq_set_group_whole_ban') {
    if (!client?.setGroupWholeBan) return deny('当前 OneBot 客户端不支持全员禁言');
    const enable = args?.enable === true;
    const result = await client.setGroupWholeBan(groupId, enable);
    const ok = result?.status === 'ok';
    return {
      ok,
      action: 'whole_ban',
      enable,
      message: ok
        ? (enable ? '已开启全员禁言' : '已关闭全员禁言')
        : `设置全员禁言失败：${result?.wording || result?.msg || '未知错误'}`,
    };
  }

  if (name === 'qq_mute_all_manageable_members' || name === 'qq_unmute_all_manageable_members') {
    const list = await getManageableMembers(client, groupId, cfg, event, botRole);
    if (!list.ok) return deny(list.message);
    const duration = name === 'qq_mute_all_manageable_members'
      ? Math.max(60, Math.min(2592000, Number(args?.duration_seconds || 600)))
      : 0;
    const results = [];
    for (const member of list.members) {
      const result = await client.setGroupBan(groupId, member.user_id, duration);
      results.push({
        user_id: member.user_id,
        display_name: member.display_name,
        ok: result?.status === 'ok',
        error: result?.status === 'ok' ? '' : (result?.wording || result?.msg || '未知错误'),
      });
    }
    const success = results.filter((item) => item.ok);
    const failed = results.filter((item) => !item.ok);
    return {
      ok: failed.length === 0,
      action: duration > 0 ? 'mute_all_manageable' : 'unmute_all_manageable',
      duration_seconds: duration,
      total_group_members: list.total_count,
      target_count: list.members.length,
      success_count: success.length,
      failed_count: failed.length,
      results,
      message: duration > 0
        ? `已批量禁言 ${success.length}/${list.members.length} 个可操作成员`
        : `已批量解除禁言 ${success.length}/${list.members.length} 个可操作成员`,
    };
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
  const summary = summarizeRawMessage(raw, event.self_id);
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
    const text = summarizeRawMessage(raw, event.self_id).slice(0, 300);
    const directedToBot = isBotMentionedRaw(raw, event.self_id) ? ' 对Bot说' : '';
    const line = `[${time}] 消息ID=${m.message_id} QQ=${m.user_id} ${name}${directedToBot}：${text}`;
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
        lines.push(`该消息引用：消息ID=${replyId} ${quotedSender}：${summarizeRawMessage(quotedRaw, event.self_id).slice(0, 300)}`);
        if (/\[CQ:image,/.test(quotedRaw) && !ai.isStickerMessage(quotedRaw)) {
          lines.push(`引用图片原始：${quotedRaw}`);
        }
        resolvedReplyCount += 1;
      }
    }
  }

  return `最近群聊消息：\n${lines.join('\n')}`;
}

function findRecentUnansweredBotMention(event, cfg) {
  if (!event.group_id || !event.self_id) return null;
  const candidates = getMessages(80, null, event.group_id)
    .filter((m) => m.message_id !== event.message_id)
    .filter((m) => !(cfg.ai_filter_stickers !== false && ai.isStickerMessage(m.raw_message)))
    .filter((m) => !isCommandContextMessage(m.raw_message, cfg.command_prefix || '/'));

  let seenBotMessage = false;
  let fallback = null;
  for (const m of candidates) {
    if (m.user_id === event.self_id) {
      seenBotMessage = true;
      continue;
    }
    const raw = String(m.raw_message || '');
    if (!isBotMentionedRaw(raw, event.self_id) || isOnlyBotMentionMessage(raw, event.self_id)) continue;
    if (seenBotMessage) continue;
    if (m.user_id === event.user_id) return m;
    if (!fallback) fallback = m;
  }
  return fallback;
}

function buildPendingBotMentionContext(event, cfg) {
  if (!isOnlyBotMentionMessage(event.raw_message || '', event.self_id)) return '';
  const pending = findRecentUnansweredBotMention(event, cfg);
  if (!pending) return '';
  const time = formatTime(pending.time);
  const name = pending.group_name || pending.nickname || String(pending.user_id || '未知用户');
  const raw = String(pending.raw_message || '');
  const text = summarizeRawMessage(raw, event.self_id).slice(0, 500);
  const imagePart = /\[CQ:image,/.test(raw) && !ai.isStickerMessage(raw)
    ? `\n该未回答请求包含图片原始：${raw}`
    : '';
  return '当前用户这次只 @ 了 Bot，没有写新问题。请优先判断他是不是在催促你继续处理最近一次未回答的 @Bot 请求：\n' +
    `[${time}] 消息ID=${pending.message_id} QQ=${pending.user_id} ${name} 对Bot说：${text}${imagePart}`;
}

async function buildGroupAwarePrompt(event, client, cfg, currentMsg, managementContext = null) {
  if (!event.group_id || !cfg.ai_group_context_enabled) return currentMsg;

  const sections = [
    '以下是当前 QQ 群聊上下文，仅用于理解用户这次 @Bot 的问题。不要主动复述上下文；如果上下文不足，不要硬猜，先判断缺的是什么。最近群聊消息里带有“消息ID=数字”和“QQ=数字”；如果某条消息是发给你的，会标成“对Bot说”，@ 信息会保留成 @Bot 或 @QQ=数字。如果缺的是群内前情、梗、代称、某人之前说过什么、某话题在本群怎么聊过、这句话接的是哪条上文，使用持久化聊天记录检索工具 qq_search_chat_history；它支持关键词、发言人QQ和时间范围过滤，query 可以为空；提到“我/我的发言”时用当前触发用户 QQ 作为 user_id。如果缺的是外部事实、最新消息、网页内容、产品/模型/公司/事件资料、价格/版本/状态等实时信息，并且联网工具可用，可以使用联网搜索或 URL 上下文。普通闲聊、能从当前消息和近期上下文直接回答的问题，不要为了显得认真而检索或联网。只有当用户明确要求引用、回复、评价某个人/某条消息，或问题里明显用“他/她/那条/上面那条”指向某条上文时，才选择消息ID，并在最终回复第一行输出“引用消息ID：数字”，第二行开始写正文。普通追问、继续、还有吗、闲聊时不要输出引用消息ID。这个标记是给系统看的，不要解释。',
  ];

  if (managementContext) {
    sections.push(
      `当前触发用户：${getEventSenderName(event)}，QQ=${event.user_id}，` +
      `${managementContext.requesterIsAdmin ? '是' : '不是'} bot 配置管理员。` +
      `我在本群的身份是${roleLabel(managementContext.botRole)}。` +
      `群管理工具${managementContext.toolsEnabled ? '可用' : '不可用'}。` +
      `群成员列表工具${managementContext.memberListEnabled ? '可用' : '不可用'}。` +
      '如果需要通过昵称、群名片或模糊称呼查 QQ 号，可以调用 qq_get_group_members；需要全部成员时不传 keyword，需要筛选时传 keyword。' +
      '如果管理员说“开启/关闭全员禁言/群禁言”，调用 qq_set_group_whole_ban。' +
      '如果管理员说“把群里所有人都禁言/给所有人上X分钟”，调用 qq_mute_all_manageable_members，不要只查成员列表。' +
      '如果管理员说“把所有禁言都解开/所有人解禁”，调用 qq_unmute_all_manageable_members。' +
      '只有用户明确要求禁言、解除禁言、踢出成员等群管理动作时才调用管理工具；不要因为普通争吵或玩笑自动管理。' +
      '如果当前消息额外 @ 了某个群成员，并且管理员要求禁言/解禁/踢出/封禁，优先把这个被 @ 的 QQ 作为 target_user_id。' +
      '调用工具时必须使用上下文里明确给出的 QQ 号作为 target_user_id，不要猜 QQ 号。'
    );
  }

  const mentionedMembers = await buildMentionedMembersContext(event, client);
  if (mentionedMembers) sections.push(mentionedMembers);

  const quoted = await buildQuotedMessageContext(event, client, cfg);
  if (quoted) sections.push(quoted);

  const pending = buildPendingBotMentionContext(event, cfg);
  if (pending) sections.push(pending);

  const recent = await buildRecentGroupContext(event, client, cfg);
  if (recent) sections.push(recent);

  sections.push(`当前用户消息：\n${annotateAtMentions(currentMsg, event.self_id)}`);
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

  // 清洗文本用于本地 AI 历史；当前请求仍会把原始 CQ 码交给 ai.js，以便提取图片。
  let cleanMsg = summarizeRawMessage(msg, event.self_id);
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
    memoryEnabled: cfg.ai_memory_enabled === true,
    searchEnabled: true,
    memberListEnabled: memberListToolsEnabled,
    managementEnabled: managementToolsEnabled,
  });
  const memorySystemPrompt = cfg.ai_memory_enabled === true
    ? buildMemorySystemPrompt(conversationKey)
    : '';

  let aiReply;
  try {
    aiReply = await ai.chat(aiInput, history, cfg, {
      functionDeclarations,
      extraSystemInstruction: memorySystemPrompt,
      executeFunctionCall: async (name, args) => {
        console.log(`[ToolCall] ${name} args=${JSON.stringify(args || {})}`);
        const result = await executeGroupManagementTool(name, args, {
          event,
          client,
          cfg,
          botRole,
          requesterIsAdmin: isAdmin,
        });
        console.log(`[ToolResult] ${name} ${JSON.stringify({
          ok: result?.ok,
          action: result?.action,
          message: result?.message,
          target_count: result?.target_count,
          success_count: result?.success_count,
          failed_count: result?.failed_count,
          returned_count: result?.returned_count,
        })}`);
        return result;
      },
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
