// 个性化记忆存储 —— 参考 Kelivo 的 assistant memory 模型，但按 QQ 会话 key 隔离

import { getMemoriesFile } from './paths.js';
import { readJsonFile, writeJsonFileAtomic } from './json-store.js';

type MemoryRecord = {
  id: number;
  conversationKey: string;
  content: string;
  created_at: string | null;
  updated_at: string | null;
};

type StoredMemoryRecord = Partial<MemoryRecord> & Record<string, unknown>;
type MemoryStoreFile = StoredMemoryRecord[] | { memories?: StoredMemoryRecord[] };

type MemorySummary = {
  key: string;
  count: number;
  updated_at: string | null;
};

const MAX_CONTENT_LENGTH = 1200;

function normalizeKey(key: unknown): string {
  return String(key || '').trim();
}

function normalizeContent(content: unknown): string {
  return String(content || '').trim().slice(0, MAX_CONTENT_LENGTH);
}

function readStore(): StoredMemoryRecord[] {
  const data = readJsonFile<MemoryStoreFile>(getMemoriesFile(), [], (value): value is MemoryStoreFile => {
    return Array.isArray(value) || (
      Boolean(value) &&
      typeof value === 'object' &&
      Array.isArray((value as { memories?: unknown }).memories)
    );
  });
  return Array.isArray(data) ? data : data.memories || [];
}

function writeStore(list: MemoryRecord[]): boolean {
  try {
    writeJsonFileAtomic(getMemoriesFile(), list);
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[MemoryStore] 写入记忆失败:', message);
    return false;
  }
}

function nextId(list: MemoryRecord[]): number {
  return list.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
}

function getAll(): MemoryRecord[] {
  return readStore()
    .filter((m) => m && normalizeKey(m.conversationKey) && normalizeContent(m.content))
    .map((m) => ({
      id: Number(m.id) || 0,
      conversationKey: normalizeKey(m.conversationKey),
      content: normalizeContent(m.content),
      created_at: m.created_at || null,
      updated_at: m.updated_at || null,
    }));
}

function getForConversation(conversationKey: unknown): MemoryRecord[] {
  const key = normalizeKey(conversationKey);
  if (!key) return [];
  return getAll()
    .filter((m) => m.conversationKey === key)
    .sort((a, b) => Number(a.id) - Number(b.id));
}

function add(conversationKey: unknown, content: unknown): MemoryRecord | null {
  const key = normalizeKey(conversationKey);
  const text = normalizeContent(content);
  if (!key || !text) return null;
  const list = getAll();
  const now = new Date().toISOString();
  const memory = {
    id: nextId(list),
    conversationKey: key,
    content: text,
    created_at: now,
    updated_at: now,
  };
  list.push(memory);
  writeStore(list);
  return memory;
}

function update(conversationKey: unknown, id: unknown, content: unknown): MemoryRecord | null {
  const key = normalizeKey(conversationKey);
  const memoryId = Number(id);
  const text = normalizeContent(content);
  if (!key || !memoryId || !text) return null;
  const list = getAll();
  const idx = list.findIndex((m) => m.id === memoryId && m.conversationKey === key);
  if (idx === -1) return null;
  list[idx] = {
    ...list[idx],
    content: text,
    updated_at: new Date().toISOString(),
  };
  writeStore(list);
  return list[idx];
}

function remove(conversationKey: unknown, id: unknown): boolean {
  const key = normalizeKey(conversationKey);
  const memoryId = Number(id);
  if (!key || !memoryId) return false;
  const list = getAll();
  const next = list.filter((m) => !(m.id === memoryId && m.conversationKey === key));
  if (next.length === list.length) return false;
  writeStore(next);
  return true;
}

function deleteForConversation(conversationKey: unknown): boolean {
  const key = normalizeKey(conversationKey);
  if (!key) return false;
  const list = getAll();
  const next = list.filter((m) => m.conversationKey !== key);
  writeStore(next);
  return next.length !== list.length;
}

function clearAll(): boolean {
  return writeStore([]);
}

function listSummaries(): MemorySummary[] {
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
  return [...groups.values()].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
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
};
