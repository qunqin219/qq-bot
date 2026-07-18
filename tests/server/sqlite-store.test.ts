import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

// 在导入被测模块前，先把数据库指向一个临时文件，避免污染运行数据。
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-test-'));
process.env.QQ_BOT_DB_PATH = path.join(tempDir, 'test.db');
process.env.QQ_BOT_STORE_BACKEND = 'sqlite';

// 延迟导入，确保上面的 env 先生效。
const { getDb } = await import('../../lib/server/store/sqlite/db.js');
const messageStore = await import('../../lib/server/store/sqlite/message-store.js');
const conversationStore = await import('../../lib/server/store/sqlite/conversation-store.js');
const memoryStore = await import('../../lib/server/store/sqlite/memory-store.js');

function clearAll(): void {
  getDb().exec('DELETE FROM messages; DELETE FROM conversation_turns; DELETE FROM memories;');
}

type MakeMessageOptions = {
  message_id?: number | string;
  user_id?: number | string;
  nickname?: string;
  card?: string;
  message_type?: string;
  group_id?: number | string;
  raw_message?: string;
};

function makeMessage(opts: MakeMessageOptions = {}) {
  return {
    message_id: opts.message_id,
    user_id: opts.user_id,
    sender: { nickname: opts.nickname ?? '', card: opts.card },
    message_type: opts.message_type ?? 'group',
    group_id: opts.group_id,
    raw_message: opts.raw_message ?? '',
  };
}

// ───────────────────────── Message Store ─────────────────────────

test('messageStore: addMessage + getMessages returns latest N', () => {
  clearAll();
  messageStore.addMessage(makeMessage({ message_id: 'm1', user_id: 100, raw_message: 'one' }));
  messageStore.addMessage(makeMessage({ message_id: 'm2', user_id: 101, raw_message: 'two' }));
  messageStore.addMessage(makeMessage({ message_id: 'm3', user_id: 102, raw_message: 'three' }));

  const recent = messageStore.getMessages(2);
  assert.equal(recent.length, 2);
  // ORDER BY id DESC，最新在前
  assert.equal(recent[0].message_id, 'm3');
  assert.equal(recent[1].message_id, 'm2');
});

test('messageStore: addMessage dedupes by message_id', () => {
  clearAll();
  messageStore.addMessage(makeMessage({ message_id: 'dup', user_id: 1, raw_message: 'first' }));
  messageStore.addMessage(makeMessage({ message_id: 'dup', user_id: 1, raw_message: 'second' }));

  const all = messageStore.getMessages(100);
  assert.equal(all.length, 1);
  assert.equal(all[0].raw_message, 'first');
});

test('messageStore: getMessages filters by group_id and user_id', () => {
  clearAll();
  messageStore.addMessage(makeMessage({ message_id: 'g1', group_id: 500, user_id: 10, raw_message: 'in group' }));
  messageStore.addMessage(makeMessage({ message_id: 'g2', group_id: 501, user_id: 10, raw_message: 'other group' }));
  messageStore.addMessage(
    makeMessage({ message_id: 'p1', message_type: 'private', group_id: undefined, user_id: 20, raw_message: 'private' })
  );

  const inGroup = messageStore.getMessages(100, null, 500);
  assert.equal(inGroup.length, 1);
  assert.equal(inGroup[0].message_id, 'g1');

  const byUser = messageStore.getMessages(100, 20, null);
  assert.equal(byUser.length, 1);
  assert.equal(byUser[0].message_id, 'p1');
});

test('messageStore: getChats extracts deduped group + private chats', () => {
  clearAll();
  messageStore.addMessage(
    makeMessage({ message_id: 'a', group_id: 700, nickname: 'u1', card: '群A', raw_message: 'hi' })
  );
  messageStore.addMessage(
    makeMessage({ message_id: 'b', group_id: 700, nickname: 'u2', card: '群A', raw_message: 'yo' })
  );
  messageStore.addMessage(
    makeMessage({ message_id: 'c', message_type: 'private', group_id: undefined, user_id: 800, nickname: '私聊人', raw_message: 'dm' })
  );

  const chats = messageStore.getChats();
  assert.equal(chats.length, 2);
  const group = chats.find((c) => c.type === 'group');
  const priv = chats.find((c) => c.type === 'private');
  assert.ok(group);
  assert.equal(String(group!.id), '700');
  assert.equal(group!.name, '群A');
  assert.ok(priv);
  assert.equal(String(priv!.id), '800');
});

test('messageStore: searchMessages matches text', () => {
  clearAll();
  messageStore.addMessage(makeMessage({ message_id: 's1', group_id: 900, user_id: 1, raw_message: 'hello world' }));
  messageStore.addMessage(makeMessage({ message_id: 's2', group_id: 900, user_id: 2, raw_message: 'goodbye sky' }));

  const result = messageStore.searchMessages({ query: 'world', groupId: 900 });
  assert.equal(result.total, 1);
  assert.equal((result.matches as Array<{ message_id: string }>)[0].message_id, 's1');
  assert.equal(result.scope, 'group:900');
});

// ───────────────────────── Conversation Store ─────────────────────────

test('conversationStore: getConversationKey returns group or private key', () => {
  clearAll();
  assert.equal(conversationStore.getConversationKey({ group_id: 123 }), 'group:123');
  assert.equal(conversationStore.getConversationKey({ user_id: 456 }), 'private:456');
  assert.equal(conversationStore.getConversationKey({ group_id: 0, user_id: 789 }), 'private:789');
  assert.equal(conversationStore.getConversationKey(null), 'private:unknown');
});

test('conversationStore: appendTurn + getHistory returns turns', () => {
  clearAll();
  const key = 'group:1001';
  assert.equal(conversationStore.appendTurn(key, '你好', '你好呀'), true);

  const history = conversationStore.getHistory(key, 20);
  assert.equal(history.length, 2);
  assert.equal(history[0].role, 'user');
  assert.equal(history[0].text, '你好');
  assert.equal(history[1].role, 'model');
  assert.equal(history[1].text, '你好呀');
});

test('conversationStore persists structured tool executions on model turns', () => {
  clearAll();
  const key = 'group:1004';
  assert.equal(conversationStore.appendTurn(key, '禁言他', '已经处理', 20, {
    model_tool_executions: [{
      tool_name: 'qq_mute_member',
      status: 'completed',
      arguments: { target_user_id: 222, duration_seconds: 300 },
      result: { ok: true, action: 'mute', target_user_id: 222, duration_seconds: 300 },
      round: 1,
      index: 1,
    }],
  }), true);

  const history = conversationStore.getHistory(key, 20);
  assert.deepEqual(history[1].tool_executions, [{
    tool_name: 'qq_mute_member',
    status: 'completed',
    arguments: { target_user_id: 222, duration_seconds: 300 },
    result: { ok: true, action: 'mute', target_user_id: 222, duration_seconds: 300 },
    round: 1,
    index: 1,
  }]);
});

test('conversationStore: appendTurn trims to maxTurns', () => {
  clearAll();
  const key = 'group:1002';
  // maxTurns = 2 → 最多保留 4 行（2 轮）
  conversationStore.appendTurn(key, 'turn1u', 'turn1m', 2);
  conversationStore.appendTurn(key, 'turn2u', 'turn2m', 2);
  conversationStore.appendTurn(key, 'turn3u', 'turn3m', 2);

  const history = conversationStore.getHistory(key, 20);
  assert.equal(history.length, 4, '应只保留最后 2 轮共 4 条');
  // 最旧的一轮已被裁剪
  assert.equal(history[0].text, 'turn2u');
  assert.equal(history[3].text, 'turn3m');

  const turns = conversationStore.getRecentTurns(key, 20);
  assert.equal(turns.length, 2);
});

test('conversationStore: clearHistory clears a single conversation', () => {
  clearAll();
  const key = 'group:1003';
  conversationStore.appendTurn(key, 'q', 'a');
  assert.equal(conversationStore.clearHistory(key), true);
  assert.equal(conversationStore.getHistory(key, 20).length, 0);
  // 没有数据时再清返回 false
  assert.equal(conversationStore.clearHistory(key), false);
});

test('conversationStore: listHistories summarizes multiple conversations', () => {
  clearAll();
  conversationStore.appendTurn('group:2001', 'u1', 'm1');
  conversationStore.appendTurn('group:2002', 'u2', 'm2');
  conversationStore.appendTurn('group:2002', 'u3', 'm3');

  const list = conversationStore.listHistories();
  assert.equal(list.length, 2);
  const k1 = list.find((r) => r.key === 'group:2001');
  const k2 = list.find((r) => r.key === 'group:2002');
  assert.ok(k1);
  assert.equal(k1!.turns, 1);
  assert.ok(k2);
  assert.equal(k2!.turns, 2);
});

// ───────────────────────── Memory Store ─────────────────────────

test('memoryStore: add + getForConversation', () => {
  clearAll();
  const rec = memoryStore.add('group:3001', '记住用户喜欢猫');
  assert.ok(rec);
  assert.ok(rec!.id > 0);
  assert.equal(rec!.conversationKey, 'group:3001');
  assert.equal(rec!.content, '记住用户喜欢猫');

  const list = memoryStore.getForConversation('group:3001');
  assert.equal(list.length, 1);
  assert.equal(list[0].content, '记住用户喜欢猫');
  // 其他会话查不到
  assert.equal(memoryStore.getForConversation('group:3002').length, 0);
});

test('memoryStore: add truncates overlong content to 1200 chars', () => {
  clearAll();
  const long = 'x'.repeat(2000);
  const rec = memoryStore.add('group:3003', long);
  assert.ok(rec);
  assert.equal(rec!.content.length, 1200);
});

test('memoryStore: update changes content for matching id+key', () => {
  clearAll();
  const added = memoryStore.add('group:3004', '旧内容');
  assert.ok(added);
  const updated = memoryStore.update('group:3004', added!.id, '新内容');
  assert.ok(updated);
  assert.equal(updated!.content, '新内容');

  // key 不匹配时返回 null
  assert.equal(memoryStore.update('group:9999', added!.id, '盗改'), null);
});

test('memoryStore: remove deletes by id+key', () => {
  clearAll();
  const rec = memoryStore.add('group:3005', '待删除');
  assert.ok(rec);
  assert.equal(memoryStore.remove('group:3005', rec!.id), true);
  assert.equal(memoryStore.getForConversation('group:3005').length, 0);
  // 再删返回 false
  assert.equal(memoryStore.remove('group:3005', rec!.id), false);
});

test('memoryStore: listSummaries aggregates multiple conversations', () => {
  clearAll();
  memoryStore.add('group:4001', 'a');
  memoryStore.add('group:4001', 'b');
  memoryStore.add('group:4002', 'c');

  const summaries = memoryStore.listSummaries();
  assert.equal(summaries.length, 2);
  const s1 = summaries.find((s) => s.key === 'group:4001');
  const s2 = summaries.find((s) => s.key === 'group:4002');
  assert.ok(s1);
  assert.equal(s1!.count, 2);
  assert.ok(s2);
  assert.equal(s2!.count, 1);
});
