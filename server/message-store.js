// 消息缓存 —— 存储最近 200 条 OneBot 事件消息，供面板查看

const fs = require('fs');
const path = require('path');

// 消息存储文件位于项目根目录
const STORE_FILE = path.join(__dirname, '..', 'messages.json');
const MAX_MESSAGES = 200;

/**
 * 加载所有缓存消息。
 */
function _load() {
  if (fs.existsSync(STORE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8'));
    } catch (e) {
      return [];
    }
  }
  return [];
}

/**
 * 保存消息到文件。
 */
function _save(msgs) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(msgs, null, 2), 'utf-8');
}

/**
 * 存储 OneBot 事件消息。
 * Node.js 单线程，无需加锁。
 */
function addMessage(event) {
  const messages = _load();
  const sender = event.sender || {};
  const entry = {
    message_id: event.message_id,
    user_id: event.user_id,
    nickname: sender.nickname || '',
    message_type: event.message_type,
    group_id: event.group_id,
    group_name: sender.card || sender.nickname || '',
    raw_message: event.raw_message || String(event.message || ''),
    time: new Date().toISOString(),
  };
  messages.unshift(entry);
  // 保留最近 MAX_MESSAGES 条
  _save(messages.slice(0, MAX_MESSAGES));
}

/**
 * 获取最近消息，支持按 user_id / group_id 筛选。
 */
function getMessages(limit = 50, userId = null, groupId = null) {
  let msgs = _load();
  if (userId !== null && userId !== undefined) {
    msgs = msgs.filter((m) => m.user_id === userId);
  }
  if (groupId !== null && groupId !== undefined) {
    msgs = msgs.filter((m) => m.group_id === groupId);
  }
  return msgs.slice(0, limit);
}

/**
 * 从消息列表中提取去重后的聊天列表。
 */
function getChats() {
  const msgs = _load();
  const chats = {};
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

module.exports = { addMessage, getMessages, getChats, MAX_MESSAGES };
