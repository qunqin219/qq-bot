// SQLite 消息存储 —— 行为与 lib/server/message-store.ts (JSON 版) 完全一致

import type { Database } from 'better-sqlite3';

import type {
  OneBotMessageEvent,
  StoredMessage,
  MessageSearchOptions,
  ChatSummary,
} from '../interfaces.js';

import { getDb } from './db.js';

// 默认保留最近 2 万条，避免长期运行时数据无限增长。
const MAX_MESSAGES = Math.max(1000, Math.min(200000, Number(process.env.QQ_BOT_MAX_STORED_MESSAGES || 20000)));
const DEFAULT_READ_LIMIT = 50;
const SEARCH_SCAN_LIMIT = 20000;

type DbRow = {
  id: number;
  message_id: string | null;
  user_id: string | null;
  nickname: string | null;
  message_type: string | null;
  group_id: string | null;
  group_name: string | null;
  raw_message: string | null;
  time: string | null;
};

// ── prepared statement 缓存 ──

const _stmtCache: Record<string, any> = {};

function stmt(sql: string) {
  let s = _stmtCache[sql];
  if (!s) {
    s = getDb().prepare(sql);
    _stmtCache[sql] = s;
  }
  return s;
}

function toText(value: number | string | null | undefined): string | null {
  return value == null ? null : String(value);
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

function rowToStored(row: DbRow): StoredMessage {
  return {
    message_id: row.message_id ?? undefined,
    user_id: row.user_id ?? undefined,
    nickname: row.nickname || '',
    message_type: row.message_type ?? undefined,
    group_id: row.group_id ?? undefined,
    group_name: row.group_name || '',
    raw_message: row.raw_message || '',
    time: row.time || '',
  };
}

function stripCqCodes(text: unknown): string {
  return String(text || '')
    .replace(/\[CQ:[^\]]+\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  ]
    .map((v) => String(v || ''))
    .join(' ');
}

function safeRegex(pattern: unknown): RegExp | null {
  try {
    return new RegExp(String(pattern || ''), 'i');
  } catch {
    return null;
  }
}

/**
 * 存储 OneBot 事件消息。
 * Node.js 单线程，无需加锁。
 */
function addMessage(event: OneBotMessageEvent): void {
  const entry = normalizeMessage(event);

  if (entry.message_id && stmt('SELECT 1 FROM messages WHERE message_id = ? LIMIT 1').get(String(entry.message_id))) {
    return;
  }

  stmt(
    'INSERT INTO messages (message_id, user_id, nickname, message_type, group_id, group_name, raw_message, time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    toText(entry.message_id),
    toText(entry.user_id),
    entry.nickname ?? '',
    toText(entry.message_type),
    toText(entry.group_id),
    entry.group_name ?? '',
    entry.raw_message ?? '',
    entry.time
  );

  const count = (stmt('SELECT COUNT(*) AS c FROM messages').get() as { c: number }).c;
  if (count > MAX_MESSAGES) {
    stmt('DELETE FROM messages WHERE id IN (SELECT id FROM messages ORDER BY id ASC LIMIT ?)').run(count - MAX_MESSAGES);
  }
}

/**
 * 获取最近消息，支持按 user_id / group_id 筛选。
 */
function getMessages(
  limit: unknown = DEFAULT_READ_LIMIT,
  userId: number | string | null = null,
  groupId: number | string | null = null
): StoredMessage[] {
  const safeLimit = Math.max(1, Math.min(5000, Number(limit) || DEFAULT_READ_LIMIT));

  const conds: string[] = [];
  const params: unknown[] = [];
  if (userId !== null && userId !== undefined) {
    conds.push('CAST(user_id AS INTEGER) = ?');
    params.push(Number(userId));
  }
  if (groupId !== null && groupId !== undefined) {
    conds.push('CAST(group_id AS INTEGER) = ?');
    params.push(Number(groupId));
  }

  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const rows = stmt(`SELECT * FROM messages ${where} ORDER BY id DESC LIMIT ?`).all(...params, safeLimit) as DbRow[];

  return rows.map(rowToStored);
}

/**
 * 在持久化聊天记录里检索。默认返回最新匹配在前。
 * scope:
 * - groupId: 只搜当前群
 * - privateUserId: 只搜当前私聊双方相关消息
 */
function searchMessages(options: MessageSearchOptions = {}): Record<string, unknown> {
  const query = String(options.query || '').trim();
  const limit = Math.max(1, Math.min(100, Number(options.limit) || 20));
  const scanLimit = Math.max(limit, Math.min(SEARCH_SCAN_LIMIT, Number(options.scanLimit) || SEARCH_SCAN_LIMIT));
  const groupId = options.groupId !== undefined && options.groupId !== null ? Number(options.groupId) : null;
  const privateUserId =
    options.privateUserId !== undefined && options.privateUserId !== null ? Number(options.privateUserId) : null;
  const senderUserId = options.userId !== undefined && options.userId !== null ? Number(options.userId) : null;
  const messageType = String(options.messageType || '').trim();
  const fromTs = options.fromTime ? Date.parse(String(options.fromTime)) : null;
  const toTs = options.toTime ? Date.parse(String(options.toTime)) : null;
  const regex = options.regex === true ? safeRegex(query) : null;
  const lower = query.toLowerCase();

  const conds: string[] = [];
  const params: unknown[] = [];
  if (groupId) {
    conds.push('CAST(group_id AS INTEGER) = ?');
    params.push(groupId);
  }
  if (privateUserId) {
    // 与 JSON 版 !m.group_id 等价：group_id 为空 / NULL / 0 视为私聊
    conds.push('(group_id IS NULL OR CAST(group_id AS INTEGER) = 0 OR group_id = ?)');
    params.push('');
    conds.push('CAST(user_id AS INTEGER) = ?');
    params.push(privateUserId);
  }
  if (senderUserId) {
    conds.push('CAST(user_id AS INTEGER) = ?');
    params.push(senderUserId);
  }
  if (messageType) {
    conds.push('message_type = ?');
    params.push(messageType);
  }
  if (fromTs !== null && Number.isFinite(fromTs)) {
    conds.push('time >= ?');
    params.push(new Date(fromTs).toISOString());
  }
  if (toTs !== null && Number.isFinite(toTs)) {
    conds.push('time <= ?');
    params.push(new Date(toTs).toISOString());
  }

  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const rows = stmt(`SELECT * FROM messages ${where} ORDER BY id DESC LIMIT ?`).all(...params, scanLimit) as DbRow[];

  const matches: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const m = rowToStored(row);
    const haystack = messageSearchText(m);
    const ok = query ? (regex ? regex.test(haystack) : haystack.toLowerCase().includes(lower)) : true;
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
    scope: groupId ? `group:${groupId}` : privateUserId ? `private:${privateUserId}` : 'all',
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
  const rows = stmt('SELECT group_id, group_name, user_id, nickname FROM messages ORDER BY id DESC').all() as Array<
    Pick<DbRow, 'group_id' | 'group_name' | 'user_id' | 'nickname'>
  >;

  const chats: Record<string, ChatSummary> = {};
  for (const m of rows) {
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
