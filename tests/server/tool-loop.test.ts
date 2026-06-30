declare const require: any;
declare const global: any;

const test = require('node:test');
const assert = require('node:assert/strict');

const ai = require('../../lib/server/ai');

type GeminiPart = {
  text?: string;
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
};

type GeminiResponse = {
  candidates: Array<{
    content: {
      role: string;
      parts: GeminiPart[];
    };
  }>;
};

type TestConfig = Record<string, unknown>;

function jsonResponse(data: Record<string, unknown>, status = 200): Record<string, unknown> {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

function functionCall(name: string, args: Record<string, unknown> = {}): GeminiResponse {
  return {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [{ functionCall: { name, args } }],
        },
      },
    ],
  };
}

function textReply(text: string): GeminiResponse {
  return {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [{ text }],
        },
      },
    ],
  };
}

function makeCfg(): TestConfig {
  return {
    ai_enabled: true,
    ai_api_key: 'test-key',
    ai_base_url: 'https://api.example.test/v1beta',
    ai_model: 'gemini-test',
    ai_filter_stickers: true,
  };
}

test('chat supports multi-round function calling', async () => {
  const oldFetch = global.fetch;
  const requests: any[] = [];
  const responses = [
    functionCall('first_tool', { q: 'a' }),
    functionCall('second_tool', { q: 'b' }),
    textReply('最终回答'),
  ];
  global.fetch = (async (_url: any, init: any) => {
    requests.push(JSON.parse(init.body));
    return jsonResponse(responses.shift()!);
  }) as any;

  const calls: Array<Record<string, any>> = [];
  try {
    const reply = await ai.chat('hello', [], makeCfg(), {
      functionDeclarations: [
        { name: 'first_tool', parameters: { type: 'object', properties: {} } },
        { name: 'second_tool', parameters: { type: 'object', properties: {} } },
      ],
      executeFunctionCall: async (name: string, args: Record<string, unknown>, meta: Record<string, unknown>) => {
        calls.push({ name, args, meta });
        return { ok: true, message: `${name} ok` };
      },
    });

    assert.equal(reply, '最终回答');
    assert.equal(requests.length, 3);
    assert.deepEqual(calls.map((c) => c.name), ['first_tool', 'second_tool']);
    assert.deepEqual(calls.map((c) => c.meta.round), [1, 2]);
    assert.equal(requests[1].contents.at(-1).parts[0].functionResponse.name, 'first_tool');
    assert.equal(requests[2].contents.at(-1).parts[0].functionResponse.name, 'second_tool');
  } finally {
    global.fetch = oldFetch;
  }
});

test('chat skips repeated same-name same-args tool calls', async () => {
  const oldFetch = global.fetch;
  const responses = [
    functionCall('repeat_tool', { id: 1 }),
    functionCall('repeat_tool', { id: 1 }),
    textReply('根据已有结果回答'),
  ];
  global.fetch = (async (_url: any, init: any) => {
    JSON.parse(init.body);
    return jsonResponse(responses.shift()!);
  }) as any;

  const calls: Array<Record<string, any>> = [];
  try {
    const reply = await ai.chat('hello', [], makeCfg(), {
      functionDeclarations: [
        { name: 'repeat_tool', parameters: { type: 'object', properties: {} } },
      ],
      executeFunctionCall: async (name: string, args: Record<string, unknown>, meta: Record<string, unknown>) => {
        calls.push({ name, args, meta });
        return { ok: true, message: 'first result' };
      },
    });

    assert.equal(reply, '根据已有结果回答');
    assert.equal(calls.length, 1, 'duplicate tool call should not execute twice');
  } finally {
    global.fetch = oldFetch;
  }
});

test('chat appends tool-provided image parts only after the model asks for an image', async () => {
  const oldFetch = global.fetch;
  const requests: any[] = [];
  const responses = [
    functionCall('qq_read_image', { message_id: 9001 }),
    textReply('看到了'),
  ];
  global.fetch = (async (_url: any, init: any) => {
    requests.push(JSON.parse(init.body));
    return jsonResponse(responses.shift()!);
  }) as any;

  try {
    const reply = await ai.chat('[CQ:image,file=demo.png,url=https://example.test/demo.png] 这是什么', [], makeCfg(), {
      autoAttachImages: false,
      functionDeclarations: [
        { name: 'qq_read_image', parameters: { type: 'object', properties: {} } },
      ],
      executeFunctionCall: async () => ({
        ok: true,
        message: '已读取图片',
        __ai_inline_parts: [
          { inline_data: { mime_type: 'image/png', data: 'aW1hZ2U=' } },
        ],
      }),
    });

    assert.equal(reply, '看到了');
    assert.equal(requests.length, 2);
    assert.equal(requests[0].contents.at(-1).parts.length, 1, 'first request should not pre-attach images');
    assert.equal(requests[0].contents.at(-1).parts[0].text, '这是什么');

    const toolParts = requests[1].contents.at(-1).parts;
    assert.equal(toolParts[0].functionResponse.name, 'qq_read_image');
    assert.equal(toolParts[0].functionResponse.response.__ai_inline_parts, undefined);
    assert.equal(toolParts[1].inline_data.mime_type, 'image/png');
  } finally {
    global.fetch = oldFetch;
  }
});

test('chat retries retryable Gemini HTTP errors before replying', async () => {
  const oldFetch = global.fetch;
  let attempts = 0;
  global.fetch = (async () => {
    attempts += 1;
    if (attempts < 3) {
      return jsonResponse({ error: { message: 'Resource exhausted' } } as any, 429);
    }
    return jsonResponse(textReply('重试后成功'));
  }) as any;

  try {
    const reply = await ai.chat('hello', [], makeCfg(), {
      maxHttpRetries: 3,
      httpRetryBaseDelayMs: 0,
    });

    assert.equal(reply, '重试后成功');
    assert.equal(attempts, 3);
  } finally {
    global.fetch = oldFetch;
  }
});

test('chat stays silent after retryable Gemini HTTP errors are exhausted', async () => {
  const oldFetch = global.fetch;
  let attempts = 0;
  global.fetch = (async () => {
    attempts += 1;
    return jsonResponse({ error: { message: 'Resource exhausted' } } as any, 429);
  }) as any;

  try {
    const reply = await ai.chat('hello', [], makeCfg(), {
      maxHttpRetries: 3,
      httpRetryBaseDelayMs: 0,
    });

    assert.equal(reply, null);
    assert.equal(attempts, 4, 'maxHttpRetries means three retries after the initial request');
  } finally {
    global.fetch = oldFetch;
  }
});

export {};
