// 消息处理逻辑 —— 管理员过滤、命令响应、自动回复（支持 AI 回复）

declare const require: any;
declare const module: any;

const { loadConfig } = require('./config');
const { addMessage, getMessages } = require('./message-store');
const fs = require('fs');
const ai = require('./ai');
const imageCache = require('./image-cache');
const conversationStore = require('./conversation-store');
const memoryStore = require('./memory-store');

const INTERNAL_INLINE_PARTS_FIELD = '__ai_inline_parts';
const IMAGE_TOOL_SEARCH_LIMIT = 120;

type Role = 'owner' | 'admin' | 'member' | 'unknown' | 'none' | string;

type BotConfig = Record<string, any> & {
  admins?: Array<number | string>;
  active_groups?: Array<number | string>;
  command_prefix?: string;
};

type OneBotSender = {
  user_id?: number | string;
  nickname?: string;
  card?: string;
  role?: Role;
  title?: string;
};

type OneBotEvent = {
  post_type?: string;
  message_type?: string;
  group_id?: number | string | null;
  user_id?: number | string | null;
  self_id?: number | string | null;
  message_id?: number | string | null;
  raw_message?: string;
  message?: unknown;
  sender?: OneBotSender;
};

type OneBotResult<T = any> = {
  status?: string;
  data?: T;
  wording?: string;
  msg?: string;
};

type OneBotClient = Record<string, any> & {
  connected?: boolean;
  sendGroupMsg?: (groupId: number | string, message: string) => Promise<OneBotResult> | OneBotResult;
  sendPrivateMsg?: (userId: number | string, message: string) => Promise<OneBotResult> | OneBotResult;
  getLoginInfo?: () => Promise<OneBotResult> | OneBotResult;
  getGroupMemberInfo?: (
    groupId: number | string,
    userId: number | string,
    noCache?: boolean
  ) => Promise<OneBotResult<Record<string, any>>> | OneBotResult<Record<string, any>>;
  getGroupMemberList?: (groupId: number | string) => Promise<OneBotResult<Array<Record<string, any>>>> | OneBotResult<Array<Record<string, any>>>;
  getMsg?: (messageId: number | string) => Promise<OneBotResult<Record<string, any>>> | OneBotResult<Record<string, any>>;
  setGroupWholeBan?: (groupId: number | string, enable: boolean) => Promise<OneBotResult> | OneBotResult;
  setGroupBan?: (groupId: number | string, userId: number | string, duration: number) => Promise<OneBotResult> | OneBotResult;
  setGroupKick?: (groupId: number | string, userId: number | string, rejectAddRequest: boolean) => Promise<OneBotResult> | OneBotResult;
};

type ToolArgs = Record<string, any>;

type GroupManagementContext = {
  event: OneBotEvent;
  client: OneBotClient;
  cfg: BotConfig;
  botRole: Role;
  requesterIsAdmin: boolean;
};

type ManagementPromptContext = {
  botRole: Role;
  toolsEnabled: boolean;
  memberListEnabled: boolean;
  requesterIsAdmin: boolean;
};

type ToolDeclarationOptions = {
  memoryEnabled?: boolean;
  imageReadEnabled?: boolean;
  memberListEnabled?: boolean;
  managementEnabled?: boolean;
};

type AiRuntimePreviewInput = {
  event: OneBotEvent;
  client: OneBotClient;
  cfg?: BotConfig;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function compactJson(value: unknown, maxLength = 900): string {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function previewText(value: unknown, maxLength = 180): string {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function summarizeToolResult(result: Record<string, any> | null | undefined): Record<string, any> {
  if (!result || typeof result !== 'object') return { ok: false, message: String(result || '') };
  return {
    ok: result.ok,
    action: result.action,
    message: result.message,
    message_id: result.message_id,
    image_key: result.image_key,
    image_index: result.image_index,
    speaker_qq: result.speaker_qq,
    speaker_name: result.speaker_name,
    target_count: result.target_count,
    success_count: result.success_count,
    failed_count: result.failed_count,
    returned_count: result.returned_count,
  };
}

function summarizeOneBotResult(result: OneBotResult | null | undefined): Record<string, any> {
  if (!result || typeof result !== 'object') return { status: 'unknown' };
  return {
    status: result.status || 'unknown',
    wording: result.wording,
    msg: result.msg,
  };
}

function buildEnabledToolAuditList(cfg: BotConfig, functionDeclarations: Array<Record<string, any>> = []): string {
  const names = functionDeclarations
    .map((item) => item?.name)
    .filter(Boolean);
  if (cfg.ai_google_search_enabled === true) names.push('googleSearch');
  if (cfg.ai_url_context_enabled === true) names.push('urlContext');
  return names.length ? names.join(',') : '-';
}

function extractReplyMessageId(msg: unknown): string | null {
  const match = String(msg || '').match(/\[CQ:reply,id=([^\],]+)[^\]]*\]/);
  return match ? match[1] : null;
}

function extractAtUserIds(msg: unknown): number[] {
  const ids: number[] = [];
  const re = /\[CQ:at,qq=([^,\]]+)[^\]]*\]/g;
  let match;
  while ((match = re.exec(String(msg || ''))) !== null) {
    const id = Number(match[1]);
    if (Number.isFinite(id)) ids.push(id);
  }
  return [...new Set(ids)];
}

function annotateAtMentions(raw: unknown, selfId: number | string | null = null): string {
  return String(raw || '').replace(/\[CQ:at,qq=([^,\]]+)[^\]]*\]/g, (_, qq) => {
    const id = Number(qq);
    if (selfId && id === Number(selfId)) return '@Bot';
    return `@QQ=${qq}`;
  });
}

function isBotMentionedRaw(raw: unknown, selfId: number | string | null | undefined): boolean {
  return Boolean(selfId) && String(raw || '').includes(`[CQ:at,qq=${selfId}]`);
}

function isOnlyBotMentionMessage(raw: unknown, selfId: number | string | null | undefined): boolean {
  if (!isBotMentionedRaw(raw, selfId)) return false;
  const text = ai.stripCqCodes(raw).trim();
  const hasMedia = /\[CQ:(image|record|video|file),/.test(String(raw || ''));
  const atIds = extractAtUserIds(raw);
  return !text && !hasMedia && atIds.length > 0 && atIds.every((id) => id === Number(selfId));
}

function formatSender(sender: OneBotSender = {}, fallbackUserId: number | string | null = ''): string | number {
  return sender.card || sender.nickname || sender.user_id || fallbackUserId || '未知用户';
}

function getEventSenderName(event: OneBotEvent): string | number {
  const sender = event?.sender || {};
  return formatSender(sender, event?.user_id || '未知用户');
}

function promptJson(value: Record<string, any>): string {
  return JSON.stringify(value);
}

function buildContextMessageRecord(
  message: Record<string, any>,
  selfId: number | string | null | undefined,
  extra: Record<string, any> = {}
): Record<string, any> {
  const raw = String(message.raw_message || '');
  const images = buildImageRefs(raw);
  return {
    message_id: message.message_id ?? null,
    time: message.time || null,
    speaker_qq: message.user_id ?? null,
    speaker_name: message.group_name || message.nickname || String(message.user_id || '未知用户'),
    directed_to_bot: isBotMentionedRaw(raw, selfId),
    text: summarizeRawMessage(raw, selfId).slice(0, 500),
    ...(images.length ? { images } : {}),
    ...extra,
  };
}

function buildImageRefs(raw: unknown): Array<Record<string, any>> {
  return imageCache.extractImageRecords(raw, {
    ignoreStickers: true,
    maxImages: 5,
  }).map((record: Record<string, any>, index: number) => ({
    image_key: imageCache.cacheKeyForRecord(record),
    image_index: index + 1,
    file: record.file || null,
    summary: record.summary || null,
    file_size: record.file_size || null,
  }));
}

function messageTime(message: Record<string, any>): string | null {
  return message.time || message.created_at || null;
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

function buildMemorySystemPrompt(conversationKey: string): string {
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
**绝对不要**在回复中提及记忆操作，例如"已帮你记下来了""我已经记住了""已更新记录"之类的话一律不能说，也不要在对话中直接显示记忆内容，除非用户主动要求查看。记忆工具调用必须完全静默，对用户不可见。
相似或相关的记忆应合并为一条记录，而不要重复记录，过时记录应删除。
你可以在和用户闲聊的时候暗示用户你能记住东西。
`);
  lines.push(`注意：这些记忆只属于当前 QQ 会话 ${conversationKey}，不要跨私聊或其他群聊使用。`);
  return lines.join('\n');
}

function parseAiReplyDirective(text: unknown): { text: string; replyMessageId: number | null } {
  const raw = String(text || '').trim();
  const match = raw.match(/^引用消息ID[:：]\s*(\d+)\s*\n+/);
  if (!match) return { text: raw, replyMessageId: null };
  return {
    replyMessageId: Number(match[1]),
    text: raw.slice(match[0].length).trim(),
  };
}

function isKnownGroupMessageId(groupId: number | string | null | undefined, messageId: number | string | null | undefined): boolean {
  if (!groupId || !messageId) return false;
  return getMessages(120, null, groupId)
    .some((m) => Number(m.message_id) === Number(messageId));
}

function userExplicitlyAskedForQuote(raw: unknown): boolean {
  const text = ai.stripCqCodes(raw).trim();
  return /引用|回复|回一下|评价一下|点评一下|这条|那条|上面那/.test(text);
}

function userLikelyTargetsContextMessage(raw: unknown): boolean {
  const text = ai.stripCqCodes(raw).trim();
  if (userExplicitlyAskedForQuote(raw)) return true;
  return /\bta\b|他|她|它|那个人|那位|刚才那/.test(text) && !/还有吗|继续说|展开|忘记/.test(text);
}

function buildGroupReplyMessage(
  event: OneBotEvent,
  cfg: BotConfig,
  text: string,
  aiSelectedMessageId: number | string | null = null
): string {
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

function summarizeRawMessage(raw: unknown, selfId: number | string | null = null): string {
  const annotated = annotateAtMentions(raw, selfId);
  const text = ai.stripCqCodes(annotated);
  const tags: string[] = [];
  if (/\[CQ:image,/.test(String(raw || ''))) tags.push('[图片]');
  if (/\[CQ:record,/.test(String(raw || ''))) tags.push('[语音]');
  if (/\[CQ:video,/.test(String(raw || ''))) tags.push('[视频]');
  if (/\[CQ:file,/.test(String(raw || ''))) tags.push('[文件]');
  return [text, ...tags].filter(Boolean).join(' ').trim() || '[非文本消息]';
}

function isCommandContextMessage(raw: unknown, prefix = '/'): boolean {
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

function formatTime(iso: unknown): string {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso as any));
  } catch {
    return '';
  }
}

function roleLabel(role: Role): string {
  if (role === 'owner') return '群主';
  if (role === 'admin') return '管理员';
  if (role === 'member') return '普通群员';
  return '未知';
}

function canManageRole(botRole: Role, targetRole: Role): boolean {
  if (!['owner', 'admin'].includes(botRole)) return false;
  if (targetRole === 'owner') return false;
  if (targetRole === 'admin' && botRole !== 'owner') return false;
  return true;
}

function adminSet(cfg: BotConfig): Set<number> {
  return new Set((cfg.admins || []).map(Number).filter(Number.isFinite));
}

function isConfiguredAdmin(cfg: BotConfig, userId: number | string | null | undefined): boolean {
  return adminSet(cfg).has(Number(userId));
}

function isGroupWithinConfiguredScope(cfg: BotConfig, groupId: number | string | null | undefined): boolean {
  if (!groupId) return true;
  if (!cfg.group_filter_enabled) return true;
  const activeGroups = (cfg.active_groups || []).map(Number).filter(Number.isFinite);
  return activeGroups.includes(Number(groupId));
}

function shouldPersistIncomingMessage(event: OneBotEvent, cfg: BotConfig, isAdmin: boolean): boolean {
  if (Number(event.user_id) === Number(event.self_id)) return false;
  if (!isGroupWithinConfiguredScope(cfg, event.group_id)) return false;
  if (!event.group_id) return isAdmin;
  return true;
}

function isMutatingGroupManagementTool(name: string): boolean {
  return [
    'qq_set_group_whole_ban',
    'qq_mute_all_manageable_members',
    'qq_unmute_all_manageable_members',
    'qq_mute_member',
    'qq_unmute_member',
    'qq_kick_member',
  ].includes(name);
}

function hasExplicitManagementConfirmation(raw: unknown): boolean {
  const text = ai.stripCqCodes(raw).trim();
  return /确认(执行|操作|禁言|解禁|解除禁言|踢出|移出|开启全员禁言|关闭全员禁言|全员禁言)/.test(text);
}

async function getMemberRole(
  client: OneBotClient,
  groupId: number | string | null | undefined,
  userId: number | string | null | undefined
): Promise<Role> {
  if (!client?.getGroupMemberInfo || !groupId || !userId) return 'unknown';
  const result = await client.getGroupMemberInfo(groupId, userId, true);
  return result?.status === 'ok' ? (result.data?.role || 'unknown') : 'unknown';
}

function buildGroupManagementFunctionDeclarations(options: ToolDeclarationOptions = {}): Array<Record<string, any>> {
  const declarations: Array<Record<string, any>> = [];
  if (options.imageReadEnabled) {
    declarations.push({
      name: 'qq_read_image',
      description: '按需读取当前 QQ 群上下文中的图片内容。只有当前问题确实需要看图、识别截图、解释图片、或用户明确指向某张图片时才调用。优先使用上下文 images 里的 image_key；也可以用 message_id 和 image_index 读取某条消息的第几张图。',
      parameters: {
        type: 'object',
        properties: {
          image_key: { type: 'string', description: '上下文 images 数组里的 image_key，最精确' },
          message_id: { type: 'integer', description: '包含图片的群消息 message_id' },
          image_index: { type: 'integer', description: '同一条消息里的第几张图片，从 1 开始。默认 1' },
          reason: { type: 'string', description: '为什么需要读取这张图片，简短说明' },
        },
      },
    });
  }
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

async function getManageableMembers(
  client: OneBotClient,
  groupId: number | string,
  cfg: BotConfig,
  event: OneBotEvent,
  botRole: Role
): Promise<Record<string, any>> {
  const result = await client.getGroupMemberList!(groupId);
  if (result?.status !== 'ok' || !Array.isArray(result.data)) {
    return {
      ok: false,
      message: `获取群成员列表失败：${result?.wording || result?.msg || '未知错误'}`,
      members: [],
    };
  }

  const configuredAdmins = adminSet(cfg);
  const members = result.data
    .map((m) => ({
      user_id: Number(m.user_id),
      nickname: m.nickname || '',
      card: m.card || '',
      display_name: m.card || m.nickname || String(m.user_id),
      role: m.role || 'unknown',
    }))
    .filter((m) => m.user_id && m.user_id !== Number(event.self_id))
    .filter((m) => !configuredAdmins.has(m.user_id))
    .filter((m) => canManageRole(botRole, m.role));
  return { ok: true, total_count: result.data.length, members };
}

function executeMemoryTool(
  name: string,
  args: ToolArgs,
  conversationKey: string,
  cfg: BotConfig
): Record<string, any> | null {
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

function idsEqual(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return false;
  if (String(a) === String(b)) return true;
  const left = Number(a);
  const right = Number(b);
  return Number.isFinite(left) && Number.isFinite(right) && left === right;
}

function senderNameForMessage(message: Record<string, any>): string | number {
  return message.group_name || message.nickname || formatSender(message.sender || {}, message.user_id);
}

function imageToolCandidateMessages(event: OneBotEvent): Array<Record<string, any>> {
  const seen = new Set<string>();
  const candidates = [event, ...getMessages(IMAGE_TOOL_SEARCH_LIMIT, null, event.group_id || null)];
  return candidates.filter((message) => {
    if (!message) return false;
    if (message.group_id && event.group_id && !idsEqual(message.group_id, event.group_id)) return false;
    const key = String(message.message_id || `${message.user_id || ''}:${messageTime(message) || ''}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findImageForTool(
  args: ToolArgs,
  event: OneBotEvent,
  cfg: BotConfig
): Record<string, any> | null {
  const wantedKey = String(args?.image_key || '').trim();
  const wantedMessageId = args?.message_id ?? null;
  const wantedIndex = Math.max(1, Number(args?.image_index || 1));
  const allowDefaultLatest = !wantedKey && !wantedMessageId;

  for (const message of imageToolCandidateMessages(event)) {
    if (wantedMessageId && !idsEqual(message.message_id, wantedMessageId)) continue;
    const raw = String(message.raw_message || message.message || '');
    const records = imageCache.extractImageRecords(raw, {
      ignoreStickers: cfg.ai_filter_stickers !== false,
      maxImages: 5,
    });
    for (const [index, record] of records.entries()) {
      const imageKey = imageCache.cacheKeyForRecord(record);
      const imageIndex = index + 1;
      if (wantedKey && imageKey !== wantedKey) continue;
      if (!wantedKey && wantedMessageId && imageIndex !== wantedIndex) continue;
      if (wantedKey || wantedMessageId || allowDefaultLatest) {
        return { message, record, imageKey, imageIndex };
      }
    }
  }

  return null;
}

async function imageRecordToInlinePart(
  record: Record<string, any>,
  meta: Record<string, any>
): Promise<{ ok: true; part: Record<string, any>; entry: Record<string, any> } | { ok: false; message: string }> {
  const entry = imageCache.getCachedImage(record) || await imageCache.cacheImageRecord(record, {
    message_id: meta.message_id || null,
    group_id: meta.group_id || null,
    user_id: meta.user_id || null,
    message_type: meta.message_type || null,
  });
  if (!entry?.file_path || !fs.existsSync(entry.file_path)) {
    return { ok: false, message: '图片还没有缓存成功，且临时 URL 可能已经不可用' };
  }
  const size = Number(entry.size || fs.statSync(entry.file_path).size || 0);
  const maxBytes = Number(imageCache.MAX_IMAGE_BYTES || 8 * 1024 * 1024);
  if (size > maxBytes) return { ok: false, message: `图片过大：${size} bytes` };
  const buf = fs.readFileSync(entry.file_path);
  return {
    ok: true,
    entry,
    part: {
      inline_data: {
        mime_type: entry.mime_type || 'image/jpeg',
        data: buf.toString('base64'),
      },
    },
  };
}

async function executeReadImageTool(
  args: ToolArgs,
  context: GroupManagementContext
): Promise<Record<string, any>> {
  const { event, cfg } = context;
  if (!event.group_id) {
    return { ok: false, message: 'qq_read_image 只能读取当前群聊上下文里的图片' };
  }
  const found = findImageForTool(args, event, cfg);
  if (!found) {
    return {
      ok: false,
      action: 'read_image',
      message: '没有在当前群最近上下文里找到这张图片；请使用上下文 images 里的 image_key 或 message_id',
    };
  }

  const { message, record, imageKey, imageIndex } = found;
  const loaded = await imageRecordToInlinePart(record, {
    message_id: message.message_id || null,
    group_id: event.group_id || null,
    user_id: message.user_id || null,
    message_type: message.message_type || 'group',
  });
  if (loaded.ok === false) {
    return {
      ok: false,
      action: 'read_image',
      message_id: message.message_id ?? null,
      image_key: imageKey,
      image_index: imageIndex,
      message: loaded.message,
    };
  }

  return {
    ok: true,
    action: 'read_image',
    message_id: message.message_id ?? null,
    image_key: imageKey,
    image_index: imageIndex,
    speaker_qq: message.user_id ?? null,
    speaker_name: senderNameForMessage(message),
    text: summarizeRawMessage(message.raw_message || message.message || '', event.self_id).slice(0, 300),
    mime_type: loaded.entry.mime_type || 'image/jpeg',
    size: loaded.entry.size || null,
    message: `已读取图片 message_id=${message.message_id ?? '-'} image_index=${imageIndex}`,
    [INTERNAL_INLINE_PARTS_FIELD]: [loaded.part],
  };
}

async function executeGroupManagementTool(
  name: string,
  args: ToolArgs,
  context: GroupManagementContext
): Promise<Record<string, any> | null> {
  const { event, client, cfg, botRole, requesterIsAdmin } = context;
  const groupId = event.group_id;
  const targetUserId = Number(args?.target_user_id || 0);

  if (name === 'create_memory' || name === 'edit_memory' || name === 'delete_memory') {
    const conversationKey = conversationStore.getConversationKey(event);
    return executeMemoryTool(name, args, conversationKey, cfg);
  }

  function deny(message: string): Record<string, any> {
    return { ok: false, message };
  }

  if (!groupId) return deny('这个工具只能在群聊里用');
  if (name === 'qq_read_image') {
    return executeReadImageTool(args, context);
  }
  if (!requesterIsAdmin) return deny('你没有权限让我读取群成员列表或执行群管理操作');
  if (isMutatingGroupManagementTool(name) && !hasExplicitManagementConfirmation(event.raw_message || '')) {
    return deny('为了避免误操作，群管理动作需要管理员在当前消息中明确写“确认执行”或“确认禁言/确认解禁/确认踢出/确认全员禁言”。我没有执行这次操作。');
  }

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
    const results: Array<Record<string, any>> = [];
    for (const member of list.members) {
      const result = await client.setGroupBan!(groupId, member.user_id, duration);
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
  if (adminSet(cfg).has(targetUserId)) return deny('不能操作配置里的管理员');

  const targetRole = await getMemberRole(client, groupId, targetUserId);
  if (!canManageRole(botRole, targetRole)) {
    return deny(`我目前是${roleLabel(botRole)}，不能操作对方这个身份：${roleLabel(targetRole)}`);
  }

  if (name === 'qq_mute_member') {
    const duration = Math.max(60, Math.min(2592000, Number(args?.duration_seconds || 600)));
    const result = await client.setGroupBan!(groupId, targetUserId, duration);
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
    const result = await client.setGroupBan!(groupId, targetUserId, 0);
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
    const result = await client.setGroupKick!(groupId, targetUserId, reject);
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

async function buildQuotedMessageContext(
  event: OneBotEvent,
  client: OneBotClient,
  cfg: BotConfig
): Promise<string> {
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

  const images = buildImageRefs(raw);
  const record = {
    message_id: replyId,
    speaker_qq: data.user_id ?? null,
    speaker_name: senderName,
    text: summary,
    ...(images.length ? { images } : {}),
  };
  return [
    'QUOTED_MESSAGE_JSON（当前消息直接引用的重点消息；speaker_* 是被引用消息的发言人）:',
    promptJson(record),
  ].join('\n');
}

async function buildMentionedMembersContext(event: OneBotEvent, client: OneBotClient): Promise<string> {
  if (!event.group_id) return '';
  const selfId = Number(event.self_id || 0);
  const ids = extractAtUserIds(event.raw_message || '')
    .filter((id) => id && id !== selfId)
    .slice(0, 5);
  if (!ids.length) return '';

  const lines: string[] = [];
  for (const id of ids) {
    const result = client?.getGroupMemberInfo
      ? await client.getGroupMemberInfo(event.group_id, id, true)
      : null;
    if (result?.status === 'ok' && result.data) {
      const name = formatSender(result.data.sender || result.data, id);
      lines.push(promptJson({
        member_qq: id,
        member_name: name,
        role: roleLabel(result.data.role || 'unknown'),
      }));
    } else {
      lines.push(promptJson({ member_qq: id }));
    }
  }
  return `MENTIONED_MEMBERS_JSONL（当前消息额外 @ 到的群成员，通常是用户要求操作/询问的对象）:\n${lines.join('\n')}`;
}

async function buildRecentGroupContext(
  event: OneBotEvent,
  client: OneBotClient,
  cfg: BotConfig
): Promise<string> {
  if (!cfg.ai_group_context_enabled || !event.group_id) return '';
  const limit = Math.max(1, Math.min(50, Number(cfg.ai_group_context_messages || 20)));
  const messagesLatestFirst = getMessages(limit + 12, null, event.group_id)
    .filter((m) => m.message_id !== event.message_id)
    .filter((m) => !(cfg.ai_group_context_exclude_bot && m.user_id === event.self_id))
    .filter((m) => !(cfg.ai_filter_stickers !== false && ai.isStickerMessage(m.raw_message)))
    .filter((m) => !isCommandContextMessage(m.raw_message, cfg.command_prefix || '/'))
    .slice(0, limit);
  const messages = messagesLatestFirst.reverse();

  if (!messages.length) return '';

  const lines: string[] = [];
  let resolvedReplyCount = 0;
  for (const m of messages) {
    const raw = String(m.raw_message || '');
    lines.push(promptJson(buildContextMessageRecord(m, event.self_id, {
      time: formatTime(m.time),
      record_type: 'recent_group_message',
    })));

    // 历史聊天里有人“引用了一条图片消息”时，当前消息本身只有 [CQ:reply]，图片在被引用消息里。
    // 这里仅把被引用消息做成文字和图片引用摘要；真正看图必须由模型按需调用 qq_read_image。
    const replyId = extractReplyMessageId(raw);
    if (replyId && client?.getMsg && cfg.ai_group_context_include_quote && resolvedReplyCount < 5) {
      const result = await client.getMsg(replyId);
      const quotedRaw = result?.status === 'ok'
        ? (result.data?.raw_message || String(result.data?.message || ''))
        : '';
      if (quotedRaw && !(cfg.ai_filter_stickers !== false && ai.isStickerMessage(quotedRaw))) {
        const quotedImages = buildImageRefs(quotedRaw);
        lines.push(promptJson({
          record_type: 'quoted_message_for_recent_group_message',
          source_message_id: m.message_id ?? null,
          quoted_message_id: replyId,
          quoted_speaker_qq: result.data?.user_id ?? null,
          quoted_speaker_name: formatSender(result.data?.sender || {}, result.data?.user_id),
          quoted_text: summarizeRawMessage(quotedRaw, event.self_id).slice(0, 500),
          ...(quotedImages.length ? { quoted_images: quotedImages } : {}),
        }));
        resolvedReplyCount += 1;
      }
    }
  }

  return `RECENT_GROUP_MESSAGES_JSONL（按时间从旧到新；每行一条记录；speaker_qq/speaker_name 永远表示该行消息的发言人；images 是可按需读取的图片引用，不是已经看过的图片）:\n${lines.join('\n')}`;
}

function findRecentUnansweredBotMention(event: OneBotEvent, cfg: BotConfig): Record<string, any> | null {
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

function buildPendingBotMentionContext(event: OneBotEvent, cfg: BotConfig): string {
  if (!isOnlyBotMentionMessage(event.raw_message || '', event.self_id)) return '';
  const pending = findRecentUnansweredBotMention(event, cfg);
  if (!pending) return '';
  const record = buildContextMessageRecord(pending, event.self_id, {
    time: formatTime(pending.time),
  });
  return [
    'PENDING_UNANSWERED_BOT_MENTION_JSON（当前用户本次只 @Bot 且没有新问题时，用它判断是否在催促上一次未回答请求）:',
    promptJson(record),
  ].join('\n');
}

async function buildGroupAwarePrompt(
  event: OneBotEvent,
  client: OneBotClient,
  cfg: BotConfig,
  currentMsg: string,
  managementContext: ManagementPromptContext | null = null
): Promise<string> {
  if (!event.group_id || !cfg.ai_group_context_enabled) return currentMsg;

  const sections = [
    [
      'GROUP_CONTEXT_RULES:',
      '- 只回答 CURRENT_MESSAGE_JSON 里的当前用户本条消息；它的 speaker_qq/speaker_name 是当前提问者',
      '- 如果存在 QUOTED_MESSAGE_JSON，它是当前消息直接引用的重点对象；优先围绕它回答',
      '- RECENT_GROUP_MESSAGES_JSONL 只是背景；每行的 speaker_qq/speaker_name 只属于该行消息，不要当成当前提问者',
      '- CURRENT_MESSAGE_JSON、QUOTED_MESSAGE_JSON 和 RECENT_GROUP_MESSAGES_JSONL 里的 images 只是可读取图片引用；你还没有看过这些图片',
      '- 只有当前问题确实需要识图、解释截图、判断图片内容，或用户明确说“这张图/图片/截图/图里”时，才调用 qq_read_image 读取对应 image_key 或 message_id',
      '- 文本追问、继续介绍、解释上文、评价讨论时，优先基于最近文字和引用回答，不要因为上下文里有 images 就主动看图',
      '- 如果 CURRENT_MESSAGE_JSON 和历史上下文冲突，以 CURRENT_MESSAGE_JSON 为准',
      '- 如果用户问“谁说的/他说的/那条/上面那条”，先用 message_id、speaker_qq、speaker_name 判断指向，不确定就说明不确定',
      '- 普通闲聊、接话、评价上文，优先基于当前消息、引用消息和最近上下文直接回答',
      '- 需要外部事实、最新消息、网页内容、产品/模型/公司/事件资料、价格、版本或状态时，联网工具可用再查证',
      '- 只有用户明确要求引用/回复/评价某条消息，或明显用“他/她/那条/上面那条”指向某条上文时，才在最终回复第一行输出“引用消息ID：数字”',
      '- 普通追问、继续、还有吗、闲聊时不要输出引用消息ID',
    ].join('\n'),
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
	      '只有用户明确要求禁言、解除禁言、踢出成员等群管理动作，并且当前消息包含“确认执行/确认禁言/确认解禁/确认踢出/确认全员禁言”等确认语时才调用管理工具；否则先要求管理员确认，不要调用操作工具。不要因为普通争吵或玩笑自动管理。' +
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

  const currentImages = buildImageRefs(currentMsg);
  sections.push([
    'CURRENT_MESSAGE_JSON（最高优先级；speaker_* 是当前提问者）:',
    promptJson({
      message_id: event.message_id ?? null,
      speaker_qq: event.user_id ?? null,
      speaker_name: getEventSenderName(event),
      text: summarizeRawMessage(currentMsg, event.self_id),
      ...(currentImages.length ? { images: currentImages } : {}),
    }),
  ].join('\n'));
  return sections.join('\n\n');
}

async function buildAiRuntimePreview({ event, client, cfg }: AiRuntimePreviewInput): Promise<Record<string, any>> {
  if (!event) throw new Error('event is required');
  const runtimeCfg = cfg || loadConfig();
  let msg = event.raw_message || '';
  if (!msg) {
    const raw = event.message;
    msg = typeof raw === 'string' ? raw : String(raw || '');
  }

  const groupId = event.group_id;
  const userId = event.user_id || 0;
  const isAdmin = isConfiguredAdmin(runtimeCfg, userId);
  const conversationKey = conversationStore.getConversationKey(event);
  const contextTurns = Math.max(1, Number(runtimeCfg.ai_context_turns || 10));
  const history = runtimeCfg.ai_context_enabled && !groupId
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

  const aiInput = await buildGroupAwarePrompt(event, client, runtimeCfg, msg, managementContext);
  const groupImageToolEnabled = Boolean(groupId && runtimeCfg.ai_group_context_enabled);
  const functionDeclarations = buildGroupManagementFunctionDeclarations({
    memoryEnabled: runtimeCfg.ai_memory_enabled === true,
    imageReadEnabled: groupImageToolEnabled,
    memberListEnabled: memberListToolsEnabled,
    managementEnabled: managementToolsEnabled,
  });
  const extraSystemInstruction = runtimeCfg.ai_memory_enabled === true
    ? buildMemorySystemPrompt(conversationKey)
    : '';
  const requestBody = await ai.buildRequestBody(aiInput, history, runtimeCfg, {
    functionDeclarations,
    extraSystemInstruction,
    autoAttachImages: !groupImageToolEnabled,
  });

  return {
    conversationKey,
    contextTurns,
    history,
    botRole,
    managementContext,
    functionDeclarations,
    extraSystemInstruction,
    aiInput,
    requestBody,
  };
}

/**
 * 处理 OneBot 事件（仅处理消息事件）。
 */
async function handleEvent(event: OneBotEvent, client: OneBotClient): Promise<void> {
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
  const groupId = event.group_id;

  console.log(
    `[BotCore] 收到消息 type=${msgType || '-'} group=${groupId || '-'} user=${userId || '-'} ` +
    `message_id=${event.message_id || '-'} sender=${previewText(getEventSenderName(event), 80) || '-'} ` +
    `msg=${previewText(summarizeRawMessage(msg, event.self_id), 220) || '-'}`
  );

  const selfId = String(event.self_id || '');
  const isMentioned = groupId ? msg.includes(`[CQ:at,qq=${selfId}]`) : false;
  const prefix = cfg.command_prefix || '/';
  const isCommand = msg.startsWith(prefix);
  const isAdmin = isConfiguredAdmin(cfg, userId);
  const withinConfiguredScope = isGroupWithinConfiguredScope(cfg, groupId);

  if (!withinConfiguredScope) return;

  // 忽略自身消息，也避免把 bot 自己的输出再次落盘成用户消息。
  if (Number(userId) === Number(event.self_id)) return;

  if (shouldPersistIncomingMessage(event, cfg, isAdmin)) {
    // 存储消息（供面板查看和允许范围内的群聊上下文检索）
    addMessage(event);

    // QQ 图片 URL 带临时 rkey，过期后无法下载；仅对允许范围内消息做后台缓存。
    if (/\[CQ:image,/.test(msg)) {
      imageCache.cacheImagesFromMessage(msg, {
        message_id: event.message_id,
        group_id: event.group_id || null,
        user_id: event.user_id || null,
        message_type: event.message_type || null,
      }, {
        ignoreStickers: cfg.ai_filter_stickers !== false,
      }).catch((e) => {
        console.warn('[ImageCache] 后台缓存任务异常:', e.message);
      });
    }
  }

  // 管理员始终可用；非管理员只在“群聊 + @bot + 面板开关开启 + 非命令”时允许触发 AI。
  const allowGroupMentionFromNonAdmin =
    groupId &&
    isMentioned &&
    !isCommand &&
    cfg.ai_allow_group_mention_from_non_admin === true;
  if (!isAdmin && !allowGroupMentionFromNonAdmin) return;

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

  // 清洗文本用于本地 AI 历史；当前请求仍会把原始 CQ 码交给 ai.ts，以便提取图片。
  let cleanMsg = summarizeRawMessage(msg, event.self_id);
  if (!cleanMsg) cleanMsg = /\[CQ:image,/.test(msg) ? '[图片]' : '你好';

  const runtime = await buildAiRuntimePreview({ event, client, cfg });
  const {
    conversationKey,
    contextTurns,
    botRole,
    functionDeclarations,
    extraSystemInstruction,
    aiInput,
  } = runtime;

  const groupImageToolEnabled = Boolean(groupId && cfg.ai_group_context_enabled);
  const aiStartedAt = Date.now();
  console.log(
    `[AI] 回复开始 conversation=${conversationKey} type=${msgType || '-'} group=${groupId || '-'} user=${userId || '-'} ` +
    `message_id=${event.message_id || '-'} sender=${previewText(getEventSenderName(event), 80) || '-'} ` +
    `context_turns=${contextTurns} tools=${buildEnabledToolAuditList(cfg, functionDeclarations)} ` +
    `input="${previewText(cleanMsg, 240)}"`
  );

  let aiReply;
  try {
    aiReply = await ai.chat(aiInput, runtime.history, cfg, {
      functionDeclarations,
      extraSystemInstruction,
      autoAttachImages: !groupImageToolEnabled,
      executeFunctionCall: async (name: string, args: ToolArgs, meta: Record<string, any> = {}) => {
        const toolStartedAt = Date.now();
        const round = meta.round || '-';
        const index = meta.index || '-';
        const auditId = [
          event.message_id || Date.now(),
          round !== '-' ? `r${round}` : null,
          index !== '-' ? `i${index}` : null,
          name,
        ].filter(Boolean).join(':');
        console.log(
          `[ToolAudit] start id=${auditId} name=${name} round=${round} index=${index} ` +
          `conversation=${conversationKey} group=${groupId || '-'} user=${userId || '-'} args=${compactJson(args || {})}`
        );
        try {
          const result = await executeGroupManagementTool(name, args, {
            event,
            client,
            cfg,
            botRole,
            requesterIsAdmin: isAdmin,
          });
          console.log(
            `[ToolAudit] end id=${auditId} name=${name} duration_ms=${Date.now() - toolStartedAt} ` +
            `result=${compactJson(summarizeToolResult(result))}`
          );
          return result;
        } catch (e) {
          console.error(
            `[ToolAudit] error id=${auditId} name=${name} duration_ms=${Date.now() - toolStartedAt} ` +
            `error=${errorMessage(e)}`
          );
          throw e;
        }
      },
    });
  } catch (err) {
    console.error('[BotCore] AI 回复失败:', err);
    return;
  }

  if (!aiReply) {
    console.warn(
      `[AI] 回复为空 conversation=${conversationKey} duration_ms=${Date.now() - aiStartedAt} ` +
      `message_id=${event.message_id || '-'}`
    );
    return;
  }

  const parsedReply = parseAiReplyDirective(aiReply);
  if (groupId && parsedReply.replyMessageId) {
    console.log(`[BotCore] 模型选择引用 message_id=${parsedReply.replyMessageId}`);
  }
  aiReply = parsedReply.text;
  if (!aiReply) {
    console.warn(
      `[AI] 回复解析后为空 conversation=${conversationKey} duration_ms=${Date.now() - aiStartedAt} ` +
      `message_id=${event.message_id || '-'}`
    );
    return;
  }

  console.log(
    `[AI] 回复生成完成 conversation=${conversationKey} duration_ms=${Date.now() - aiStartedAt} ` +
    `reply_chars=${String(aiReply).length} quote_message_id=${parsedReply.replyMessageId || '-'} ` +
    `reply_preview="${previewText(aiReply, 240)}"`
  );

  const historyUserText = cleanMsg;
  const historyAssistantText = aiReply;
  conversationStore.appendTurn(conversationKey, historyUserText, historyAssistantText, contextTurns, groupId ? {
    user_id: userId,
    user_name: getEventSenderName(event),
  } : {});

  if (groupId) {
    const outboundMessage = buildGroupReplyMessage(event, cfg, aiReply, parsedReply.replyMessageId);
    console.log(
      `[AI] 发送群回复 conversation=${conversationKey} group=${groupId} message_id=${event.message_id || '-'} ` +
      `chars=${String(aiReply).length} quote_message_id=${parsedReply.replyMessageId || extractReplyMessageId(outboundMessage) || '-'}`
    );
    const sendResult = await client.sendGroupMsg!(groupId, outboundMessage);
    console.log(`[AI] 群回复发送完成 conversation=${conversationKey} result=${compactJson(summarizeOneBotResult(sendResult))}`);
  } else {
    console.log(
      `[AI] 发送私聊回复 conversation=${conversationKey} user=${userId || '-'} ` +
      `message_id=${event.message_id || '-'} chars=${String(aiReply).length}`
    );
    const sendResult = await client.sendPrivateMsg!(userId as any, aiReply);
    console.log(`[AI] 私聊回复发送完成 conversation=${conversationKey} result=${compactJson(summarizeOneBotResult(sendResult))}`);
  }
}

/**
 * 处理管理员命令。
 */
async function handleCommand(
  cmd: string,
  event: OneBotEvent,
  client: OneBotClient,
  _cfg?: BotConfig
): Promise<void> {
  const userId = event.user_id;
  const groupId = event.group_id;

  async function reply(text: string): Promise<void> {
    if (groupId) {
      await client.sendGroupMsg!(groupId, text);
    } else {
      await client.sendPrivateMsg!(userId as any, text);
    }
  }

  cmd = cmd.trim();
  if (!cmd) return;
  const parts = cmd.split(/\s+/);
  const name = parts[0].toLowerCase();

  if (name === 'ping') {
    await reply('pong! 🏓');
  } else if (name === 'status') {
    const info = await client.getLoginInfo!();
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

module.exports = { handleEvent, handleCommand, buildAiRuntimePreview };

export {};
