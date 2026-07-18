import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as ai from '../../lib/server/ai.js';
import { limitToolResult } from '../../lib/server/agent/tools.js';

declare const global: any;

function jsonResponse(data: Record<string, unknown>, status = 200): Record<string, unknown> {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

function makeCfg(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ai_enabled: true,
    ai_provider: 'openai',
    ai_api_key: 'test-openai-key',
    ai_base_url: 'https://api.example.test',
    ai_model: 'gpt-5.6-sol',
    ai_thinking_enabled: true,
    ai_thinking_level: 'medium',
    ai_filter_stickers: true,
    ...overrides,
  };
}

test('OpenAI request builder supports the complete GPT-5.6 family and Responses fields', async () => {
  for (const model of ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.6']) {
    const body = await ai.buildRequestBody('继续', [
      { role: 'user', text: '你好' },
      { role: 'model', text: '你好，需要什么帮助？' },
    ], makeCfg({ ai_model: model, ai_thinking_level: 'xhigh' }), {
      extraSystemInstruction: '只执行经过授权的操作。',
      functionDeclarations: [
        {
          name: 'lookup_member',
          description: '查找群成员',
          parameters: {
            type: 'object',
            properties: { keyword: { type: 'string' } },
          },
        },
      ],
      extraParts: [
        { inline_data: { mime_type: 'image/png', data: 'aW1hZ2U=' } },
      ],
    });

    assert.equal(body.model, model);
    assert.deepEqual(body.reasoning, { effort: 'xhigh' });
    assert.match(body.instructions, /只执行经过授权的操作/);
    assert.match(body.instructions, /默认不要在回复中输出 URL/);
    assert.deepEqual(body.input.slice(0, 2).map((item: any) => item.role), ['user', 'assistant']);
    assert.equal(body.input.at(-1).content[0].type, 'input_text');
    assert.equal(body.input.at(-1).content[1].type, 'input_image');
    assert.equal(body.input.at(-1).content[1].image_url, 'data:image/png;base64,aW1hZ2U=');
    assert.deepEqual(body.tools[0], {
      type: 'function',
      name: 'lookup_member',
      description: '查找群成员',
      parameters: {
        type: 'object',
        properties: { keyword: { type: 'string' } },
      },
    });
  }
});

test('OpenAI tool loop resolves tool images through a direct vision request before continuation', async () => {
  const oldFetch = global.fetch;
  const requests: Array<{ url: string; init: Record<string, any>; body: Record<string, any> }> = [];
  const progress: Array<Record<string, any>> = [];
  const imageData = 'a'.repeat(32_000);
  const responses = [
    {
      id: 'resp_tool',
      model: 'gpt-5.6-terra',
      status: 'completed',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: '我先仔细看一下图片。' }],
        },
        {
          type: 'function_call',
          id: 'fc_1',
          call_id: 'call_123',
          name: 'qq_read_image',
          arguments: '{"message_id":9001}',
        },
      ],
    },
    {
      id: 'resp_image_reader',
      model: 'gpt-5.6-terra',
      status: 'completed',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: '图片识别结果：画面中是一只猫。' }],
        },
      ],
    },
    {
      id: 'resp_final',
      model: 'gpt-5.6-terra',
      status: 'completed',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: '图片中是一只猫。' }],
        },
      ],
    },
  ];
  global.fetch = (async (url: string, init: Record<string, any>) => {
    requests.push({ url, init, body: JSON.parse(String(init.body)) });
    return jsonResponse(responses.shift()!);
  }) as any;

  try {
    const reply = await ai.chat('看看图片', [], makeCfg({
      ai_model: 'gpt-5.6-terra',
      ai_thinking_level: 'low',
    }), {
      functionDeclarations: [
        { name: 'qq_read_image', parameters: { type: 'object', properties: {} } },
      ],
      executeFunctionCall: async (name, args) => {
        assert.equal(name, 'qq_read_image');
        assert.deepEqual(args, { message_id: 9001 });
        return limitToolResult({
          ok: true,
          message: '已读取图片',
          __ai_inline_parts: [
            { inline_data: { mime_type: 'image/png', data: imageData } },
          ],
        }, 4_000);
      },
      onProgress: (update) => { progress.push(update); },
    });

    assert.equal(reply, '图片中是一只猫。');
    assert.equal(requests.length, 3);
    assert.deepEqual(progress, [{
      round: 1,
      text: '我先仔细看一下图片。',
      source: 'model',
      toolNames: ['qq_read_image'],
    }]);
    assert.equal(requests[0].url, 'https://api.example.test/v1/responses');
    assert.equal(requests[0].init.headers.Authorization, 'Bearer test-openai-key');
    assert.equal(requests[0].body.stream, true);

    const imageReader = requests[1].body;
    assert.equal(imageReader.input.length, 1);
    assert.equal(imageReader.tools, undefined);
    assert.match(imageReader.input[0].content[0].text, /主 Agent 当前需要回答的用户请求：看看图片/);
    assert.equal(imageReader.input[0].content[1].type, 'input_image');
    assert.equal(imageReader.input[0].content[1].image_url, `data:image/png;base64,${imageData}`);
    assert.equal(imageReader.input[0].content[1].detail, 'original');

    const continuation = requests[2].body.input;
    assert.ok(continuation.some((item: any) => item.type === 'function_call' && item.call_id === 'call_123'));
    const output = continuation.find((item: any) => item.type === 'function_call_output');
    assert.equal(output.call_id, 'call_123');
    assert.equal(typeof output.output, 'string');
    const toolOutput = JSON.parse(output.output);
    assert.equal(toolOutput.__ai_inline_parts, undefined);
    assert.equal(toolOutput.image_analysis, '图片识别结果：画面中是一只猫。');
    assert.equal(continuation.some((item: any) => (
      item.role === 'user' && item.content?.some((part: any) => part.type === 'input_image')
    )), false);
  } finally {
    global.fetch = oldFetch;
  }
});

test('OpenAI provider consumes Responses SSE streams without exposing unsolicited citations', async () => {
  const oldFetch = global.fetch;
  let requestBody: Record<string, any> | null = null;
  const progress: Array<Record<string, any>> = [];
  global.fetch = (async (_url: string, init: Record<string, any>) => {
    requestBody = JSON.parse(String(init.body));
    const events = [
      { type: 'response.created', response: { id: 'resp_stream', model: 'gpt-5.6-sol', status: 'in_progress' } },
      { type: 'response.output_item.added', output_index: 0, item: { type: 'web_search_call', id: 'ws_stream', status: 'in_progress' } },
      { type: 'response.output_item.added', output_index: 0, item: { type: 'message', role: 'assistant', content: [] } },
      { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: '流式搜索完成。' },
      {
        type: 'response.output_text.annotation.added',
        output_index: 0,
        content_index: 0,
        annotation: { type: 'url_citation', title: 'OpenAI Docs', url: 'https://developers.openai.com/' },
      },
      { type: 'response.completed', response: { id: 'resp_stream', model: 'gpt-5.6-sol', status: 'completed' } },
    ];
    const sse = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`;
    const encoded = new TextEncoder().encode(sse);
    const stream = new ReadableStream({
      start(controller) {
        for (let offset = 0; offset < encoded.length; offset += 37) {
          controller.enqueue(encoded.slice(offset, offset + 37));
        }
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
    });
  }) as any;

  try {
    const reply = await ai.chat('搜索 OpenAI 文档', [], makeCfg({
      ai_web_search_enabled: true,
    }), {
      onProgress: (update) => { progress.push(update); },
    });
    assert.equal((requestBody as Record<string, any> | null)?.stream, true);
    assert.equal(reply, '流式搜索完成。');
    assert.deepEqual(progress, [{
      round: 1,
      text: '',
      source: 'builtin_tool',
      toolNames: ['web_search'],
    }]);
  } finally {
    global.fetch = oldFetch;
  }
});

test('OpenAI Responses web_search is configurable and hides unsolicited links and sources', async () => {
  const oldFetch = global.fetch;
  let requestBody: Record<string, any> | null = null;
  let builtinAudits: Array<Record<string, any>> = [];
  global.fetch = (async (_url: string, init: Record<string, any>) => {
    requestBody = JSON.parse(String(init.body));
    return jsonResponse({
      id: 'resp_search',
      model: 'gpt-5.6-luna',
      status: 'completed',
      output: [
        {
          type: 'web_search_call',
          id: 'ws_1',
          status: 'completed',
          action: {
            type: 'search',
            queries: ['今天的科技新闻'],
            sources: [
              { type: 'url', url: 'https://example.com/news', title: 'Example News' },
            ],
          },
        },
        {
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: '今天有一条值得关注的科技新闻。详情见 ([example.com](https://example.com/news))。\n\n来源：\n- Example News\n  https://example.com/news',
              annotations: [
                {
                  type: 'url_citation',
                  start_index: 0,
                  end_index: 10,
                  url: 'https://example.com/news',
                  title: 'Example News',
                },
                {
                  type: 'url_citation',
                  start_index: 0,
                  end_index: 10,
                  url: 'https://example.com/news',
                  title: 'Duplicate',
                },
              ],
            },
          ],
        },
      ],
    });
  }) as any;

  try {
    const reply = await ai.chat('搜索一下今天的科技新闻', [], makeCfg({
      ai_model: 'gpt-5.6-luna',
      ai_web_search_enabled: true,
      ai_web_search_context_size: 'high',
    }), {
      onBuiltinToolCalls: (calls) => { builtinAudits = calls; },
    });

    const capturedBody = requestBody as Record<string, any> | null;
    assert.ok(capturedBody);
    assert.deepEqual((capturedBody as Record<string, any>).tools, [
      { type: 'web_search', search_context_size: 'high' },
    ]);
    assert.deepEqual((capturedBody as Record<string, any>).include, ['web_search_call.action.sources']);
    assert.match(reply || '', /今天有一条值得关注的科技新闻/);
    assert.doesNotMatch(reply || '', /来源：/);
    assert.doesNotMatch(reply || '', /https:\/\//);
    assert.doesNotMatch(reply || '', /example\.com/);
    assert.deepEqual(builtinAudits, [{
      callId: 'ws_1',
      name: 'web_search',
      status: 'completed',
      input: { action: 'search', queries: ['今天的科技新闻'] },
      output: {
        source_count: 1,
        sources: [{ title: 'Example News', url: 'https://example.com/news' }],
      },
    }]);
  } finally {
    global.fetch = oldFetch;
  }
});

test('OpenAI provider preserves links when the user explicitly requests them', async () => {
  const oldFetch = global.fetch;
  global.fetch = (async () => jsonResponse({
    id: 'resp_requested_link',
    model: 'gpt-5.6-sol',
    status: 'completed',
    output: [{
      type: 'message',
      role: 'assistant',
      content: [{
        type: 'output_text',
        text: '官网链接：https://openai.com/',
      }],
    }],
  })) as any;

  try {
    const reply = await ai.chat('请给我官网链接', [], makeCfg());
    assert.equal(reply, '官网链接：https://openai.com/');
  } finally {
    global.fetch = oldFetch;
  }
});

test('OpenAI provider accepts OPENAI_API_KEY without storing it in config', () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'environment-test-key';
  try {
    assert.equal(ai.isConfigured(makeCfg({ ai_api_key: '' }) as any), true);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});
