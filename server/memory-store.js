// 个性化记忆存储 —— 参考 Kelivo 的 assistant memory 模型，但按 QQ 会话 key 隔离

const fs = require('fs');
const path = require('path');

// memories.json 位于项目根目录
const STORE_FILE = path.join(__dirname, '..', 'memories.json');
const MAX_CONTENT_LENGTH = 1200;

function normalizeKey(key) {
  return String(key || '').trim();
}

function normalizeContent(content) {
  return String(content || '').trim().slice(0, MAX_CONTENT_LENGTH);
}

function readStore() {
  try {
    if (!fs.existsSync(STORE_FILE)) return [];
    const raw = fs.readFileSync(STORE_FILE, 'utf-8');
    if (!raw.trim()) return [];
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.memories)) return data.memories;
    return [];
  } catch (e) {
    console.warn('[MemoryStore] 读取记忆失败，使用空记忆:', e.message);
    return [];
  }
}

function writeStore(list) {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(list, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('[MemoryStore] 写入记忆失败:', e.message);
    return false;
  }
}

function nextId(list) {
  return list.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
}

function getAll() {
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

function getForConversation(conversationKey) {
  const key = normalizeKey(conversationKey);
  if (!key) return [];
  return getAll()
    .filter((m) => m.conversationKey === key)
    .sort((a, b) => Number(a.id) - Number(b.id));
}

function add(conversationKey, content) {
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

function update(conversationKey, id, content) {
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

function remove(conversationKey, id) {
  const key = normalizeKey(conversationKey);
  const memoryId = Number(id);
  if (!key || !memoryId) return false;
  const list = getAll();
  const next = list.filter((m) => !(m.id === memoryId && m.conversationKey === key));
  if (next.length === list.length) return false;
  writeStore(next);
  return true;
}

function deleteForConversation(conversationKey) {
  const key = normalizeKey(conversationKey);
  if (!key) return false;
  const list = getAll();
  const next = list.filter((m) => m.conversationKey !== key);
  writeStore(next);
  return next.length !== list.length;
}

function clearAll() {
  return writeStore([]);
}

function listSummaries() {
  const groups = new Map();
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

module.exports = {
  getAll,
  getForConversation,
  add,
  update,
  remove,
  deleteForConversation,
  clearAll,
  listSummaries,
};
