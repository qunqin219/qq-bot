const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const botCore = require('../bot-core');
const { DEFAULT_CONFIG } = require('../config');

const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

async function withImageServer(fn) {
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
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}/backend-log.png`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function makeConfig(overrides = {}) {
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

function makeGroupEvent(rawMessage) {
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

function makeClient() {
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
    assert.match(preview.aiInput, /当前用户这次明确输入的文字指令优先级最高/);
    assert.match(preview.aiInput, /不要因为同条消息里的图片/);
    assert.match(preview.extraSystemInstruction, /## Memories/);
    assert.match(preview.extraSystemInstruction, /## Memory Tool/);

    const tools = preview.requestBody.tools || [];
    assert.ok(tools.some((tool) => Array.isArray(tool.functionDeclarations)), 'function tools should be present');
    assert.ok(tools.some((tool) => tool.googleSearch), 'googleSearch should be present');
    assert.ok(tools.some((tool) => tool.urlContext), 'urlContext should be present');

    const declarations = tools.flatMap((tool) => tool.functionDeclarations || []);
    const names = declarations.map((item) => item.name).sort();
    assert.ok(names.includes('qq_search_chat_history'));
    assert.ok(names.includes('create_memory'));
    assert.ok(names.includes('edit_memory'));
    assert.ok(names.includes('delete_memory'));

    const last = preview.requestBody.contents.at(-1);
    assert.equal(last.role, 'user');
    assert.match(last.parts[0].text, /sam最新动态/);
    assert.match(last.parts[0].text, /当前用户这次明确输入的文字指令优先级最高/);
    assert.equal(last.parts.length, 2, 'the screenshot should still be attached as image input');
    assert.equal(last.parts[1].inline_data.mime_type, 'image/png');
  });
});
