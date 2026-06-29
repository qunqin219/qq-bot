// 对话上下文存储 —— 按私聊/群聊会话隔离，使用 JSON 文件持久化

const fs = require('fs');
const path = require('path');

// conversations.json 位于项目根目录
const STORE_FILE = path.join(__dirname, '..', 'conversations.json');

/**
 * 根据 OneBot 事件生成会话 key。
 * 私聊：private:${user_id}；群聊：group:${group_id}
 */
function getConversationKey(event) {
  if (!event) return 'private:unknown';
  if (event.group_id) return `group:${event.group_id}`;
  return `private:${event.user_id || 'unknown'}`;
}

/**
 * 安全读取全部历史；文件不存在或解析失败时返回空对象。
 */
function readStore() {
  try {
    if (!fs.existsSync(STORE_FILE)) return {};
    const raw = fs.readFileSync(STORE_FILE, 'utf-8');
    if (!raw.trim()) return {};
    const data = JSON.parse(raw);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch (e) {
    console.warn('[ConversationStore] 读取对话历史失败，使用空历史:', e.message);
    return {};
  }
}

/**
 * 安全写入全部历史。
 */
function writeStore(data) {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('[ConversationStore] 写入对话历史失败:', e.message);
    return false;
  }
}

/**
 * 获取指定会话最近 limit 条消息，返回 Gemini 可用的 role/text 列表。
 */
function getHistory(key, limit = 20) {
  if (!key) return [];
  const data = readStore();
  const messages = Array.isArray(data[key]?.messages) ? data[key].messages : [];
  const safeLimit = Math.max(0, Number(limit) || 20);
  return messages
    .slice(-safeLimit)
    .filter((m) => m && (m.role === 'user' || m.role === 'model') && typeof m.text === 'string')
    .map((m) => ({ role: m.role, text: m.text, time: m.time }));
}

function stripLegacyUserPrefix(text) {
  const value = String(text || '');
  const match = value.match(/^(.{1,80}?) 问：([\s\S]*)$/);
  return match ? { speaker_name: match[1], text: match[2] } : { speaker_name: null, text: value };
}

function stripLegacyModelPrefix(text) {
  const value = String(text || '');
  const match = value.match(/^Bot 回复 (.{1,80}?)：([\s\S]*)$/);
  return match ? { target_name: match[1], text: match[2] } : { target_name: null, text: value };
}

function getRecentTurns(key, limit = 8) {
  if (!key) return [];
  const data = readStore();
  const messages = Array.isArray(data[key]?.messages) ? data[key].messages : [];
  const turns = [];
  let pendingUser = null;
  for (const message of messages) {
    if (!message || typeof message.text !== 'string') continue;
    if (message.role === 'user') {
      pendingUser = message;
      continue;
    }
    if (message.role === 'model' && pendingUser) {
      const user = stripLegacyUserPrefix(pendingUser.text);
      const assistant = stripLegacyModelPrefix(message.text);
      turns.push({
        time: message.time || pendingUser.time || null,
        user_id: pendingUser.user_id || null,
        user_name: pendingUser.user_name || pendingUser.speaker_name || user.speaker_name || null,
        user_text: user.text,
        assistant_text: assistant.text,
      });
      pendingUser = null;
    }
  }
  const safeLimit = Math.max(1, Math.min(20, Number(limit) || 8));
  return turns.slice(-safeLimit);
}

/**
 * 追加一轮用户/模型对话，并限制每个会话最多 maxTurns * 2 条消息。
 */
function appendTurn(key, userText, assistantText, maxTurns = 20, meta = {}) {
  if (!key || !userText || !assistantText) return false;
  const data = readStore();
  const now = new Date().toISOString();
  const entry = data[key] || { updated_at: now, messages: [] };
  const messages = Array.isArray(entry.messages) ? entry.messages : [];
  const userEntry = { role: 'user', text: String(userText), time: now };
  const modelEntry = { role: 'model', text: String(assistantText), time: now };
  if (meta.user_id) userEntry.user_id = meta.user_id;
  if (meta.user_name) userEntry.user_name = meta.user_name;
  messages.push(userEntry);
  messages.push(modelEntry);

  const turns = Math.max(1, Number(maxTurns) || 20);
  entry.messages = messages.slice(-(turns * 2));
  entry.updated_at = now;
  data[key] = entry;
  return writeStore(data);
}

/**
 * 清空指定会话历史。
 */
function clearHistory(key) {
  if (!key) return false;
  const data = readStore();
  const existed = Object.prototype.hasOwnProperty.call(data, key);
  delete data[key];
  writeStore(data);
  return existed;
}

/**
 * 清空全部会话历史。
 */
function clearAllHistories() {
  return writeStore({});
}

/**
 * 列出全部会话摘要，turns 表示对话轮数，updated_at 为最近更新时间。
 */
function listHistories() {
  const data = readStore();
  return Object.entries(data)
    .map(([key, value]) => {
      const messageCount = Array.isArray(value?.messages) ? value.messages.length : 0;
      return {
        key,
        turns: Math.ceil(messageCount / 2),
        updated_at: value?.updated_at || null,
      };
    })
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}

module.exports = {
  getConversationKey,
  getHistory,
  getRecentTurns,
  appendTurn,
  clearHistory,
  clearAllHistories,
  listHistories,
};
