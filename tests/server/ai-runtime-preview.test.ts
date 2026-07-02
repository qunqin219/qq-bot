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
const conversationStore = require('../../lib/server/conversation-store');

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

test('runtime preview attaches current group image with the text context', async () => {
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
    assert.match(preview.aiInput, /"images":\[/);
    assert.doesNotMatch(preview.aiInput, /\[CQ:image/);
    assert.match(preview.extraSystemInstruction, /## Memories/);
    assert.match(preview.extraSystemInstruction, /## Memory Tool/);

    const tools = preview.requestBody.tools || [];
    assert.ok(tools.some((tool) => Array.isArray(tool.functionDeclarations)), 'function tools should be present');
    assert.ok(tools.some((tool) => tool.googleSearch), 'googleSearch should be present');
    assert.ok(tools.some((tool) => tool.urlContext), 'urlContext should be present');

    const declarations = tools.flatMap((tool: Record<string, any>) => tool.functionDeclarations || []);
    const names = declarations.map((item: Record<string, any>) => item.name).sort();
    // 历史图片不再默认塞给模型看，改成让模型按需调用 qq_read_image 工具读取，所以群聊里这个工具应该始终可用。
    assert.equal(names.includes('qq_read_image'), true);
    assert.equal(names.includes('qq_search_chat_history'), false);
    assert.ok(names.includes('create_memory'));
    assert.ok(names.includes('edit_memory'));
    assert.ok(names.includes('delete_memory'));

    const last = preview.requestBody.contents.at(-1);
    assert.equal(last.role, 'user');
    assert.match(last.parts[0].text, /sam最新动态/);
    assert.match(last.parts[0].text, /CURRENT_MESSAGE_JSON/);
    assert.match(last.parts[0].text, /"speaker_qq":3605900361/);
    assert.ok(last.parts.some((part: Record<string, any>) => /CONTEXT_IMAGE/.test(String(part.text || ''))));
    assert.ok(last.parts.some((part: Record<string, any>) => part.inline_data?.mime_type === 'image/png'));
  });
});

test('group runtime uses role history for the bot own previous replies', async () => {
  conversationStore.appendTurn('group:424242424', '你怎么看', '00', 10, {
    user_gemini_content: {
      role: 'user',
      parts: [{ text: '你怎么看' }],
    },
    model_gemini_content: {
      role: 'model',
      parts: [{ text: '00', thoughtSignature: 'model-sig' }],
    },
  });

  const preview = await botCore.buildAiRuntimePreview({
    event: makeGroupEvent('[CQ:at,qq=1525899506] 继续你刚刚说的'),
    client: makeClient(),
    cfg: makeConfig({ ai_context_enabled: true }),
  });

  assert.equal(preview.conversationKey, 'group:424242424');
  assert.equal(preview.history.length, 2, 'group chats should keep recent AI turns as Gemini role history');
  assert.equal(preview.requestBody.contents.length, 3);
  assert.equal(preview.requestBody.contents[0].role, 'user');
  assert.equal(preview.requestBody.contents[0].parts[0].text, '你怎么看');
  assert.equal(preview.requestBody.contents[1].role, 'model');
  assert.equal(preview.requestBody.contents[1].parts[0].text, '00');
  assert.equal(preview.requestBody.contents[1].parts[0].thoughtSignature, 'model-sig');
  assert.match(preview.requestBody.contents.at(-1).parts[0].text, /CURRENT_MESSAGE_JSON/);

  const declarations = (preview.requestBody.tools || []).flatMap((tool: Record<string, any>) => tool.functionDeclarations || []);
  const names = declarations.map((item: Record<string, any>) => item.name);
  assert.equal(names.includes('qq_get_ai_conversation_history'), false);
  assert.equal(names.includes('qq_search_chat_history'), false);
  assert.doesNotMatch(preview.aiInput, /qq_get_ai_conversation_history/);
  assert.doesNotMatch(preview.aiInput, /qq_search_chat_history/);
});

test('unrelated recent image is not auto-attached when the question is not about it', async () => {
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
    // 引用的消息本身没有图片，当前问题也没提到"图/截图"，
    // momo 那张跟话题无关的历史图片不应该被自动附带给模型看，避免带偏回答。
    const last = preview.requestBody.contents.at(-1);
    assert.ok(!last.parts.some((part: Record<string, any>) => part.inline_data?.mime_type === 'image/png'));
  });
});

test('question about a historical image gets a text reference and the read-image tool, not the raw image', async () => {
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

    // 历史图片只留下 image_key/message_id 的文字引用，不会自动把图片本身塞进去。
    assert.match(preview.aiInput, /"message_id":9101/);
    assert.match(preview.aiInput, /"images":\[/);

    const last = preview.requestBody.contents.at(-1);
    assert.ok(last.parts.some((part: Record<string, any>) => /"message_id":9101/.test(String(part.text || ''))));
    assert.ok(!last.parts.some((part: Record<string, any>) => part.inline_data?.mime_type === 'image/png'));

    // 模型如果判断确实需要看这张图，应该能通过 qq_read_image 工具按需读取。
    const declarations = (preview.requestBody.tools || []).flatMap((tool: Record<string, any>) => tool.functionDeclarations || []);
    assert.ok(declarations.some((item: Record<string, any>) => item.name === 'qq_read_image'));
  });
});

export {};
