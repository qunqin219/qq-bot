import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as ai from '../../lib/server/ai.js';

declare const global: any;

type GeminiPart = {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
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

test('buildRequestBody uses thinkingLevel for Gemini 3 models', async () => {
  const body = await ai.buildRequestBody('hello', [], {
    ...makeCfg(),
    ai_model: 'gemini-3.5-flash',
    ai_thinking_enabled: true,
    ai_thinking_level: 'high',
  });

  assert.deepEqual(body.generationConfig?.thinkingConfig, {
    includeThoughts: true,
    thinkingLevel: 'high',
  });
  assert.equal('thinkingBudget' in (body.generationConfig?.thinkingConfig || {}), false);
});

test('buildRequestBody uses thinkingBudget for Gemini 2.5 models', async () => {
  const body = await ai.buildRequestBody('hello', [], {
    ...makeCfg(),
    ai_model: 'gemini-2.5-flash',
    ai_thinking_enabled: true,
    ai_thinking_level: 'high',
  });

  assert.deepEqual(body.generationConfig?.thinkingConfig, {
    includeThoughts: true,
    thinkingBudget: 8192,
  });
  assert.equal('thinkingLevel' in (body.generationConfig?.thinkingConfig || {}), false);
});

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

test('chat blocks leaked thought text and retries once for a clean reply', async () => {
  const oldFetch = global.fetch;
  const requests: any[] = [];
  const responses = [
    textReply('_thought\n我先分析内部过程\n最终可能是这个意思'),
    textReply('这是在玩“不交代上下文让 AI 猜”的梗'),
  ];
  global.fetch = (async (_url: any, init: any) => {
    requests.push(JSON.parse(init.body));
    return jsonResponse(responses.shift()!);
  }) as any;

  try {
    const reply = await ai.chat('你发 2 个 0 是啥意思', [], makeCfg());

    assert.equal(reply, '这是在玩“不交代上下文让 AI 猜”的梗');
    assert.equal(requests.length, 2);
    assert.match(requests[1].contents.at(-1).parts[0].text, /内部草稿、思维链/);
  } finally {
    global.fetch = oldFetch;
  }
});

test('buildRequestBody preserves stored Gemini thought signatures in history', async () => {
  const body = await ai.buildRequestBody('继续', [
    {
      role: 'user',
      text: '上一句',
      gemini_content: {
        role: 'user',
        parts: [{ text: '上一句', thoughtSignature: 'user-sig' }],
      },
    },
    {
      role: 'model',
      text: '上一答',
      gemini_content: {
        role: 'model',
        parts: [{ text: '上一答', thoughtSignature: 'model-sig' }],
      },
    },
  ], makeCfg());

  assert.equal((body.contents[0].parts[0] as any).thoughtSignature, 'user-sig');
  assert.equal((body.contents[1].parts[0] as any).thoughtSignature, 'model-sig');
  assert.equal((body.contents[2].parts[0] as any).text, '继续');
});

test('chat ignores thought summary text and stores only safe native response parts', async () => {
  const oldFetch = global.fetch;
  const captured: Array<Record<string, any>> = [];
  global.fetch = (async () => {
    return jsonResponse({
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              { text: '内部摘要不要发出去', thought: true, thoughtSignature: 'opaque-thought' },
              { text: '最终回答', thoughtSignature: 'visible-sig' },
            ],
          },
        },
      ],
    });
  }) as any;

  try {
    const reply = await ai.chat('hello', [], makeCfg(), {
      onFinalTurn: (turn: Record<string, any>) => captured.push(turn),
    });

    assert.equal(reply, '最终回答');
    assert.equal(captured.length, 1);
    assert.equal(captured[0].modelContent.parts.length, 1);
    assert.equal(captured[0].modelContent.parts[0].text, '最终回答');
    assert.equal(captured[0].modelContent.parts[0].thoughtSignature, 'visible-sig');
  } finally {
    global.fetch = oldFetch;
  }
});

test('chat logs Gemini thought summary parts', async () => {
  const oldFetch = global.fetch;
  const oldLog = console.log;
  const logs: string[] = [];
  global.fetch = (async () => {
    return jsonResponse({
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              { text: '内部摘要', thought: true },
              { text: '最终回答' },
            ],
          },
        },
      ],
    });
  }) as any;
  console.log = (...args: unknown[]) => {
    logs.push(args.map((item) => String(item)).join(' '));
  };

  try {
    const reply = await ai.chat('hello', [], makeCfg());

    assert.equal(reply, '最终回答');
    assert.match(logs.join('\n'), /思考过程 round=1/);
    assert.match(logs.join('\n'), /内部摘要/);
  } finally {
    global.fetch = oldFetch;
    console.log = oldLog;
  }
});

test('chat strips delimited think blocks from otherwise clean replies', async () => {
  const oldFetch = global.fetch;
  global.fetch = (async () => {
    return jsonResponse(textReply('<think>这里是内部推理</think>可以，刚才那句是模型抽风了'));
  }) as any;

  try {
    const reply = await ai.chat('刚才怎么回事', [], makeCfg());

    assert.equal(reply, '可以，刚才那句是模型抽风了');
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
