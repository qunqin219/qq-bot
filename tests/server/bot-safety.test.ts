declare const require: any;
declare const process: any;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-bot-safety-test-'));
process.env.QQ_BOT_CONFIG_FILE = path.join(tempRoot, 'config.json');
process.env.QQ_BOT_MESSAGES_FILE = path.join(tempRoot, 'messages.json');
process.env.QQ_BOT_CONVERSATIONS_FILE = path.join(tempRoot, 'conversations.json');
process.env.QQ_BOT_MEMORIES_FILE = path.join(tempRoot, 'memories.json');
process.env.QQ_BOT_IMAGE_CACHE_DIR = path.join(tempRoot, 'images');
process.env.QQ_BOT_SESSIONS_FILE = path.join(tempRoot, 'sessions.json');

const ai = require('../../lib/server/ai');
const botCore = require('../../lib/server/bot-core');
const { DEFAULT_CONFIG, saveConfig } = require('../../lib/server/config');
const { getMessages } = require('../../lib/server/message-store');

type TestEvent = Record<string, any> & {
  group_id?: number | null;
  user_id?: number;
  self_id?: number;
  raw_message?: string;
};

type ToolResult = Record<string, any>;

function messageEvent(overrides: TestEvent = {}): TestEvent {
  const groupId = Object.hasOwn(overrides, 'group_id') ? overrides.group_id : 10001;
  return {
    post_type: 'message',
    message_type: groupId ? 'group' : 'private',
    group_id: groupId,
    user_id: 222,
    self_id: 999,
    message_id: Math.floor(Math.random() * 1000000),
    raw_message: 'hello',
    message: 'hello',
    sender: { nickname: 'member', card: 'member' },
    ...overrides,
  };
}

test('ignored private and out-of-scope group messages are not persisted', async () => {
  saveConfig({
    ...DEFAULT_CONFIG,
    admins: [111],
    group_filter_enabled: true,
    active_groups: [10001],
    ai_enabled: false,
  });

  const client: Record<string, any> = {};
  await botCore.handleEvent(messageEvent({ group_id: null, user_id: 222, raw_message: 'private ignored' }), client);
  await botCore.handleEvent(messageEvent({ group_id: 99999, raw_message: 'outside group ignored' }), client);
  assert.equal(getMessages(10).length, 0);

  await botCore.handleEvent(messageEvent({ group_id: 10001, raw_message: 'allowed group context' }), client);
  const stored = getMessages(10);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].raw_message, 'allowed group context');
});

test('mutating group management tools require explicit confirmation', async () => {
  saveConfig({
    ...DEFAULT_CONFIG,
    admins: [111],
    ai_enabled: true,
    ai_api_key: 'test-key',
    ai_group_context_enabled: false,
    ai_memory_enabled: false,
  });

  const oldChat = ai.chat;
  let toolResult: ToolResult = {};
  let banCalls = 0;
  const sent: string[] = [];
  const client = {
    getGroupMemberInfo: async (_groupId: number, userId: number) => ({
      status: 'ok',
      data: { user_id: userId, role: userId === 999 ? 'admin' : 'member' },
    }),
    setGroupBan: async () => {
      banCalls += 1;
      return { status: 'ok' };
    },
    sendGroupMsg: async (_groupId: number, message: string) => {
      sent.push(message);
      return { status: 'ok' };
    },
  };

  ai.chat = async (_input: string, _history: any[], _cfg: Record<string, any>, options: Record<string, any>) => {
    toolResult = await options.executeFunctionCall('qq_mute_member', {
      target_user_id: 222,
      duration_seconds: 600,
    });
    return toolResult.message;
  };

  try {
    await botCore.handleEvent(messageEvent({
      user_id: 111,
      raw_message: '[CQ:at,qq=999] 禁言 [CQ:at,qq=222]',
    }), client);
    assert.equal(banCalls, 0);
    const firstToolResult = toolResult as Record<string, any>;
    assert.equal(firstToolResult.ok, false);
    assert.match(firstToolResult.message, /确认/);
    assert.match(sent[0], /确认/);

    await botCore.handleEvent(messageEvent({
      user_id: 111,
      raw_message: '[CQ:at,qq=999] 确认禁言 [CQ:at,qq=222]',
    }), client);
    assert.equal(banCalls, 1);
    const secondToolResult = toolResult as Record<string, any>;
    assert.equal(secondToolResult.ok, true);
  } finally {
    ai.chat = oldChat;
  }
});

export {};
