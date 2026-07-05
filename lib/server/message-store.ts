// 消息存储 —— 持久化 OneBot 事件消息，供面板查看和群聊上下文构建

import { getMessagesFile } from './paths.js';
import { readJsonFile, writeJsonFileAtomic } from './json-store.js';

type OneBotSender = {
  nickname?: string;
  card?: string;
};

type OneBotMessageEvent = {
  message_id?: number | string;
  user_id?: number | string;
  sender?: OneBotSender;
  message_type?: string;
  group_id?: number | string;
  raw_message?: string;
  message?: unknown;
};

type StoredMessage = {
  message_id?: number | string;
  user_id?: number | string;
  nickname: string;
  message_type?: string;
  group_id?: number | string;
  group_name: string;
  raw_message: string;
  time: string;
};

type MessageSearchOptions = {
  query?: unknown;
  limit?: unknown;
  scanLimit?: unknown;
  groupId?: unknown;
  privateUserId?: unknown;
  userId?: unknown;
  messageType?: unknown;
  fromTime?: string | number | Date;
  toTime?: string | number | Date;
  regex?: boolean;
};

type ChatSummary = {
  id: number | string;
  type: 'group' | 'private';
  name: string;
};

// 默认保留最近 2 万条，避免长期运行时单个 JSON 文件无限增长。
const MAX_MESSAGES = Math.max(1000, Math.min(200000, Number(process.env.QQ_BOT_MAX_STORED_MESSAGES || 20000)));
const DEFAULT_READ_LIMIT = 50;
const SEARCH_SCAN_LIMIT = 20000;

/**
 * 加载所有缓存消息。文件里保持“最新在前”的顺序。
 */
function _load(): StoredMessage[] {
  return readJsonFile<StoredMessage[]>(getMessagesFile(), [], Array.isArray);
}

/**
 * 保存消息到文件。
 */
function _save(msgs: StoredMessage[]): void {
  writeJsonFileAtomic(getMessagesFile(), msgs);
}

function normalizeMessage(event: OneBotMessageEvent): StoredMessage {
  const sender = event.sender || {};
  return {
    message_id: event.message_id,
    user_id: event.user_id,
    nickname: sender.nickname || '',
    message_type: event.message_type,
    group_id: event.group_id,
    group_name: sender.card || sender.nickname || '',
    raw_message: event.raw_message || String(event.message || ''),
    time: new Date().toISOString(),
  };
}

/**
 * 存储 OneBot 事件消息。
 * Node.js 单线程，无需加锁。
 */
function addMessage(event: OneBotMessageEvent): void {
  const messages = _load();
  const entry = normalizeMessage(event);
  if (entry.message_id && messages.some((m) => m.message_id === entry.message_id)) return;
  messages.unshift(entry);
  _save(messages.slice(0, MAX_MESSAGES));
}

/**
 * 获取最近消息，支持按 user_id / group_id 筛选。
 */
function getMessages(
  limit: unknown = DEFAULT_READ_LIMIT,
  userId: number | string | null = null,
  groupId: number | string | null = null
): StoredMessage[] {
  let msgs = _load();
  if (userId !== null && userId !== undefined) {
    msgs = msgs.filter((m) => Number(m.user_id) === Number(userId));
  }
  if (groupId !== null && groupId !== undefined) {
    msgs = msgs.filter((m) => Number(m.group_id) === Number(groupId));
  }
  const safeLimit = Math.max(1, Math.min(5000, Number(limit) || DEFAULT_READ_LIMIT));
  return msgs.slice(0, safeLimit);
}

function stripCqCodes(text: unknown): string {
  return String(text || '').replace(/\[CQ:[^\]]+\]/g, ' ').replace(/\s+/g, ' ').trim();
}

function messageSearchText(m: StoredMessage): string {
  return [
    m.raw_message,
    stripCqCodes(m.raw_message),
    m.nickname,
    m.group_name,
    m.user_id,
    m.group_id,
    m.message_id,
  ].map((v) => String(v || '')).join(' ');
}

function safeRegex(pattern: unknown): RegExp | null {
  try {
    return new RegExp(String(pattern || ''), 'i');
  } catch {
    return null;
  }
}

/**
 * 在持久化聊天记录里检索。默认返回最新匹配在前。
 * scope:
 * - groupId: 只搜当前群
 * - privateUserId: 只搜当前私聊双方相关消息
 */
function searchMessages(options: MessageSearchOptions = {}) {
  const query = String(options.query || '').trim();
  const limit = Math.max(1, Math.min(100, Number(options.limit) || 20));
  const scanLimit = Math.max(limit, Math.min(SEARCH_SCAN_LIMIT, Number(options.scanLimit) || SEARCH_SCAN_LIMIT));
  const groupId = options.groupId !== undefined && options.groupId !== null ? Number(options.groupId) : null;
  const privateUserId = options.privateUserId !== undefined && options.privateUserId !== null ? Number(options.privateUserId) : null;
  const senderUserId = options.userId !== undefined && options.userId !== null ? Number(options.userId) : null;
  const messageType = String(options.messageType || '').trim();
  const fromTs = options.fromTime ? Date.parse(String(options.fromTime)) : null;
  const toTs = options.toTime ? Date.parse(String(options.toTime)) : null;
  const regex = options.regex === true ? safeRegex(query) : null;
  const lower = query.toLowerCase();

  let msgs = _load();
  if (groupId) msgs = msgs.filter((m) => Number(m.group_id) === groupId);
  if (privateUserId) msgs = msgs.filter((m) => !m.group_id && Number(m.user_id) === privateUserId);
  if (senderUserId) msgs = msgs.filter((m) => Number(m.user_id) === senderUserId);
  if (messageType) msgs = msgs.filter((m) => String(m.message_type || '') === messageType);
  if (fromTs !== null && Number.isFinite(fromTs)) msgs = msgs.filter((m) => Date.parse(m.time || '') >= fromTs);
  if (toTs !== null && Number.isFinite(toTs)) msgs = msgs.filter((m) => Date.parse(m.time || '') <= toTs);

  const matches = [];
  for (const m of msgs.slice(0, scanLimit)) {
    const haystack = messageSearchText(m);
    const ok = query
      ? (regex ? regex.test(haystack) : haystack.toLowerCase().includes(lower))
      : true;
    if (!ok) continue;
    matches.push({
      message_id: m.message_id,
      time: m.time,
      user_id: m.user_id,
      nickname: m.nickname || '',
      group_id: m.group_id,
      group_name: m.group_name || '',
      raw_message: m.raw_message || '',
      text: stripCqCodes(m.raw_message),
    });
    if (matches.length >= limit) break;
  }

  return {
    query,
    scope: groupId ? `group:${groupId}` : (privateUserId ? `private:${privateUserId}` : 'all'),
    filters: {
      user_id: senderUserId || null,
      message_type: messageType || null,
      from_time: fromTs !== null && Number.isFinite(fromTs) ? new Date(fromTs).toISOString() : null,
      to_time: toTs !== null && Number.isFinite(toTs) ? new Date(toTs).toISOString() : null,
    },
    total: matches.length,
    limit,
    matches,
  };
}

/**
 * 从消息列表中提取去重后的聊天列表。
 */
function getChats(): ChatSummary[] {
  const msgs = _load();
  const chats: Record<string, ChatSummary> = {};
  for (const m of msgs) {
    const gid = m.group_id;
    const uid = m.user_id;
    if (gid && !chats[gid]) {
      chats[gid] = {
        id: gid,
        type: 'group',
        name: m.group_name || String(gid),
      };
    }
    if (!gid && uid && !chats[uid]) {
      chats[uid] = {
        id: uid,
        type: 'private',
        name: m.nickname || String(uid),
      };
    }
  }
  return Object.values(chats);
}

export {
  addMessage,
  getMessages,
  searchMessages,
  getChats,
  MAX_MESSAGES,
};
