// SQLite 记忆存储实现 —— 行为与 lib/server/memory-store.ts (JSON 版) 完全一致

import type { Database } from 'better-sqlite3';
import type { MemoryRecord, MemorySummary } from '../interfaces.js';

import { getDb } from './db.js';

const MAX_CONTENT_LENGTH = 1200;

function normalizeKey(key: unknown): string {
  return String(key || '').trim();
}

function normalizeContent(content: unknown): string {
  return String(content || '').trim().slice(0, MAX_CONTENT_LENGTH);
}

// ── prepared statement 缓存 ──

const _stmtCache: Record<string, any> = {};

function stmt(sql: string): any {
  let s = _stmtCache[sql];
  if (!s) {
    s = getDb().prepare(sql);
    _stmtCache[sql] = s;
  }
  return s;
}

type MemoryRow = {
  id: number | string;
  conversation_key: string;
  content: string;
  created_at: string | null;
  updated_at: string | null;
};

function mapRow(row: MemoryRow): MemoryRecord {
  return {
    id: Number(row.id) || 0,
    conversationKey: normalizeKey(row.conversation_key),
    content: normalizeContent(row.content),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

// 与 JSON 版一致：过滤掉 conversationKey / content 为空的记录
function toRecords(rows: MemoryRow[]): MemoryRecord[] {
  return rows
    .filter((r) => normalizeKey(r.conversation_key) && normalizeContent(r.content))
    .map(mapRow);
}

const SQL_SELECT_ALL =
  'SELECT id, conversation_key, content, created_at, updated_at FROM memories';
const SQL_SELECT_BY_KEY =
  'SELECT id, conversation_key, content, created_at, updated_at FROM memories WHERE conversation_key = ? ORDER BY id ASC';
const SQL_SELECT_ONE =
  'SELECT id, conversation_key, content, created_at, updated_at FROM memories WHERE id = ? AND conversation_key = ?';
const SQL_INSERT =
  'INSERT INTO memories (conversation_key, content, created_at, updated_at) VALUES (?, ?, ?, ?)';
const SQL_UPDATE =
  'UPDATE memories SET content = ?, updated_at = ? WHERE id = ? AND conversation_key = ?';
const SQL_DELETE_ONE = 'DELETE FROM memories WHERE id = ? AND conversation_key = ?';
const SQL_DELETE_BY_KEY = 'DELETE FROM memories WHERE conversation_key = ?';
const SQL_CLEAR_ALL = 'DELETE FROM memories';

function getAll(): MemoryRecord[] {
  const rows = stmt(SQL_SELECT_ALL).all() as MemoryRow[];
  return toRecords(rows);
}

function getForConversation(conversationKey: unknown): MemoryRecord[] {
  const key = normalizeKey(conversationKey);
  if (!key) return [];
  const rows = stmt(SQL_SELECT_BY_KEY).all(key) as MemoryRow[];
  return toRecords(rows);
}

function add(conversationKey: unknown, content: unknown): MemoryRecord | null {
  const key = normalizeKey(conversationKey);
  const text = normalizeContent(content);
  if (!key || !text) return null;
  const now = new Date().toISOString();
  const info = stmt(SQL_INSERT).run(key, text, now, now) as { lastInsertRowid: number | bigint };
  return {
    id: Number(info.lastInsertRowid) || 0,
    conversationKey: key,
    content: text,
    created_at: now,
    updated_at: now,
  };
}

function update(conversationKey: unknown, id: unknown, content: unknown): MemoryRecord | null {
  const key = normalizeKey(conversationKey);
  const memoryId = Number(id);
  const text = normalizeContent(content);
  if (!key || !memoryId || !text) return null;
  const now = new Date().toISOString();
  // 与 JSON 版一致：必须同时匹配 id AND conversation_key
  const info = stmt(SQL_UPDATE).run(text, now, memoryId, key) as { changes: number };
  if (info.changes === 0) return null;
  const row = stmt(SQL_SELECT_ONE).get(memoryId, key) as MemoryRow | undefined;
  return row ? mapRow(row) : null;
}

function remove(conversationKey: unknown, id: unknown): boolean {
  const key = normalizeKey(conversationKey);
  const memoryId = Number(id);
  if (!key || !memoryId) return false;
  const info = stmt(SQL_DELETE_ONE).run(memoryId, key) as { changes: number };
  return info.changes > 0;
}

function deleteForConversation(conversationKey: unknown): boolean {
  const key = normalizeKey(conversationKey);
  if (!key) return false;
  const info = stmt(SQL_DELETE_BY_KEY).run(key) as { changes: number };
  return info.changes > 0;
}

function clearAll(): boolean {
  try {
    stmt(SQL_CLEAR_ALL).run();
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[MemoryStore] 清空记忆失败:', message);
    return false;
  }
}

function listSummaries(): MemorySummary[] {
  // 直接基于 getAll() 计算，确保与 JSON 版的过滤规则和排序（localeCompare）完全一致
  const groups = new Map<string, MemorySummary>();
  for (const m of getAll()) {
    const current = groups.get(m.conversationKey) || {
      key: m.conversationKey,
      count: 0,
      updated_at: null,
    };
    current.count += 1;
    if (!current.updated_at || String(m.updated_at || '').localeCompare(String(current.updated_at)) > 0) {
      current.updated_at = m.updated_at;
    }
    groups.set(m.conversationKey, current);
  }
  return [...groups.values()].sort((a, b) =>
    String(b.updated_at || '').localeCompare(String(a.updated_at || ''))
  );
}

export {
  getAll,
  getForConversation,
  add,
  update,
  remove,
  deleteForConversation,
  clearAll,
  listSummaries,
  MAX_CONTENT_LENGTH,
};
