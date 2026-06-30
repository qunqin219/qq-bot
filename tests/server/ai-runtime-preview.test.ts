declare const require: any;
declare const process: any;
declare const Buffer: any;

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-bot-runtime-preview-test-'));
process.env.QQ_BOT_ALLOW_LOCAL_IMAGE_FETCH = '1';
process.env.QQ_BOT_MESSAGES_FILE = path.join(tempRoot, 'messages.json');
process.env.QQ_BOT_CONVERSATIONS_FILE = path.join(tempRoot, 'conversations.json');
process.env.QQ_BOT_MEMORIES_FILE = path.join(tempRoot, 'memories.json');

const botCore = require('../../lib/server/bot-core');
const { DEFAULT_CONFIG } = require('../../lib/server/config');
const { addMessage } = require('../../lib/server/message-store');

const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

type TestConfig = Record<string, any>;
type TestEvent = Record<string, any>;
type TestClient = Record<string, any>;

async function withImageServer(fn: (imageUrl: string) => Promise<void>): Promise<void> {
  const server = http.createServer((req, res) => {
    if (req.url === '/backend-log.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(ONE_BY_ONE_PNG);
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  try {
    return await fn(`http://127.0.0.1:${port}/backend-log.png`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function makeConfig(overrides: TestConfig = {}): TestConfig {
  return {
    ...DEFAULT_CONFIG,
    admins: [3605900361],
    ai_enabled: true,
    ai_api_key: 'test-api-key-not-real',
    ai_base_url: 'https://api.example.test/v1beta',
    ai_model: 'gemini-3.5-flash',
    ai_context_enabled: false,
    ai_google_search_enabled: true,
    ai_url_context_enabled: true,
    ai_memory_enabled: true,
    ai_group_context_enabled: true,
    ai_allow_group_mention_from_non_admin: true,
    ...overrides,
  };
}

function makeGroupEvent(rawMessage: string): TestEvent {
  return {
    post_type: 'message',
    message_type: 'group',
    group_id: 424242424,
    user_id: 3605900361,
    self_id: 1525899506,
    message_id: 10001,
    raw_message: rawMessage,
    message: rawMessage,
    sender: { nickname: 'qunqin', card: 'qunqin Sleep' },
  };
}

function makeClient(): TestClient {
  return {
    connected: true,
    getGroupMemberInfo: async () => ({ status: 'ok', data: { role: 'admin' } }),
    getMsg: async () => ({ status: 'failed', data: null }),
  };
}

test('runtime preview shows current @ text outranks an attached backend-log screenshot', async () => {
  assert.equal(typeof botCore.buildAiRuntimePreview, 'function');

  await withImageServer(async (imageUrl) => {
    const raw = `[CQ:at,qq=1525899506] sam最新动态[CQ:image,file=backend-log.png,url=${imageUrl}]`;
    const preview = await botCore.buildAiRuntimePreview({
      event: makeGroupEvent(raw),
      client: makeClient(),
      cfg: makeConfig(),
    });

    assert.equal(preview.conversationKey, 'group:424242424');
    assert.match(preview.aiInput, /sam最新动态/);
    assert.match(preview.aiInput, /CURRENT_MESSAGE_JSON/);
    assert.match(preview.aiInput, /speaker_qq/);
    assert.match(preview.aiInput, /候选图需要你判断相关性/);
    assert.match(preview.extraSystemInstruction, /## Memories/);
    assert.match(preview.extraSystemInstruction, /## Memory Tool/);

    const tools = preview.requestBody.tools || [];
    assert.ok(tools.some((tool) => Array.isArray(tool.functionDeclarations)), 'function tools should be present');
    assert.ok(tools.some((tool) => tool.googleSearch), 'googleSearch should be present');
    assert.ok(tools.some((tool) => tool.urlContext), 'urlContext should be present');

    const declarations = tools.flatMap((tool: Record<string, any>) => tool.functionDeclarations || []);
    const names = declarations.map((item: Record<string, any>) => item.name).sort();
    assert.equal(names.includes('qq_search_chat_history'), false);
    assert.ok(names.includes('create_memory'));
    assert.ok(names.includes('edit_memory'));
    assert.ok(names.includes('delete_memory'));

    const last = preview.requestBody.contents.at(-1);
    assert.equal(last.role, 'user');
    assert.match(last.parts[0].text, /sam最新动态/);
    assert.match(last.parts[0].text, /CURRENT_MESSAGE_JSON/);
    assert.match(last.parts[0].text, /"speaker_qq":3605900361/);
    assert.equal(last.parts.length, 2, 'the screenshot should still be attached as image input');
    assert.equal(last.parts[1].inline_data.mime_type, 'image/png');
  });
});

test('group runtime does not expose chat-search or AI-history tools', async () => {
  const preview = await botCore.buildAiRuntimePreview({
    event: makeGroupEvent('[CQ:at,qq=1525899506] 继续你刚刚说的'),
    client: makeClient(),
    cfg: makeConfig({ ai_context_enabled: true }),
  });

  assert.equal(preview.conversationKey, 'group:424242424');
  assert.deepEqual(preview.history, [], 'group chats should not inject conversations.json as Gemini role history');
  assert.equal(preview.requestBody.contents.length, 1, 'request body should only contain current grouped prompt');

  const declarations = (preview.requestBody.tools || []).flatMap((tool: Record<string, any>) => tool.functionDeclarations || []);
  const names = declarations.map((item: Record<string, any>) => item.name);
  assert.equal(names.includes('qq_get_ai_conversation_history'), false);
  assert.equal(names.includes('qq_search_chat_history'), false);
  assert.doesNotMatch(preview.aiInput, /qq_get_ai_conversation_history/);
  assert.doesNotMatch(preview.aiInput, /qq_search_chat_history/);
});

test('quoted link question does not attach unrelated recent group images', async () => {
  await withImageServer(async (imageUrl) => {
    addMessage({
      post_type: 'message',
      message_type: 'group',
      group_id: 424242424,
      user_id: 2054323568,
      message_id: 9001,
      raw_message: `[CQ:image,file=unrelated.png,url=${imageUrl}]`,
      message: `[CQ:image,file=unrelated.png,url=${imageUrl}]`,
      sender: { nickname: 'momo' },
    });
    addMessage({
      post_type: 'message',
      message_type: 'group',
      group_id: 424242424,
      user_id: 3605900361,
      message_id: 9002,
      raw_message: '【【IGN】动画剧集《赛博朋克：边缘行者2》先导预告】https://www.bilibili.com/video/BV1smKX6kED6',
      message: '【【IGN】动画剧集《赛博朋克：边缘行者2》先导预告】https://www.bilibili.com/video/BV1smKX6kED6',
      sender: { nickname: 'qunqin', card: 'qunqin Sleep' },
    });

    const client = makeClient();
    client.getMsg = async (messageId: number | string) => {
      if (Number(messageId) !== 9002) return { status: 'failed', data: null };
      return {
        status: 'ok',
        data: {
          message_id: 9002,
          user_id: 3605900361,
          raw_message: '【【IGN】动画剧集《赛博朋克：边缘行者2》先导预告】https://www.bilibili.com/video/BV1smKX6kED6',
          sender: { nickname: 'qunqin', card: 'qunqin Sleep' },
        },
      };
    };

    const preview = await botCore.buildAiRuntimePreview({
      event: {
        ...makeGroupEvent('[CQ:reply,id=9002][CQ:at,qq=1525899506] 介绍一下这个'),
        message_id: 9003,
      },
      client,
      cfg: makeConfig(),
    });

    assert.match(preview.aiInput, /QUOTED_MESSAGE_JSON/);
    assert.match(preview.aiInput, /BV1smKX6kED6/);
    assert.doesNotMatch(preview.aiInput, /recent_group_message_image/);

    const last = preview.requestBody.contents.at(-1);
    assert.equal(last.parts.length, 1, 'unrelated recent images should stay out of visual input');
  });
});

test('image question exposes recent images as model-chosen visual candidates', async () => {
  await withImageServer(async (imageUrl) => {
    addMessage({
      post_type: 'message',
      message_type: 'group',
      group_id: 515151515,
      user_id: 2054323568,
      message_id: 9101,
      raw_message: `[CQ:image,file=target.png,url=${imageUrl}]`,
      message: `[CQ:image,file=target.png,url=${imageUrl}]`,
      sender: { nickname: 'momo' },
    });

    const preview = await botCore.buildAiRuntimePreview({
      event: {
        ...makeGroupEvent('[CQ:at,qq=1525899506] 这张图是什么意思'),
        group_id: 515151515,
        message_id: 9102,
      },
      client: makeClient(),
      cfg: makeConfig(),
    });

    assert.match(preview.aiInput, /RECENT_IMAGE_ATTACHMENTS_JSONL/);
    assert.match(preview.aiInput, /"message_id":9101/);

    const last = preview.requestBody.contents.at(-1);
    assert.equal(last.parts.length, 2, 'the recent image candidate should be attached once');
    assert.equal(last.parts[1].inline_data.mime_type, 'image/png');
  });
});

export {};
