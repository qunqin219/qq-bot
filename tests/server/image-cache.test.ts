import type { IncomingMessage, ServerResponse } from 'node:http';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import * as ai from '../../lib/server/ai.js';
import * as imageCache from '../../lib/server/image-cache.js';

process.env.QQ_BOT_ALLOW_LOCAL_IMAGE_FETCH = '1';

const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

type ImageServerHandle = {
  url: string;
  close: () => Promise<void>;
};

async function startImageServer(): Promise<ImageServerHandle> {
  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/cached.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(ONE_BY_ONE_PNG);
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}/cached.png`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

test('AI image input can use local cache after source URL is gone', async () => {
  const imageServer = await startImageServer();
  const uniqueFile = `cache-test-${Date.now()}-${Math.random().toString(16).slice(2)}.png`;
  const raw = `[CQ:image,file=${uniqueFile},url=${imageServer.url}]`;

  const cached = await imageCache.cacheImagesFromMessage(raw, {
    message_id: 998877,
    group_id: 424242,
    user_id: 3605900361,
    message_type: 'group',
  });
  assert.equal(cached.length, 1);
  assert.equal(cached[0].mime_type, 'image/png');

  await imageServer.close();

  const body = await ai.buildRequestBody(raw, [], { ai_filter_stickers: true });
  const last = body.contents.at(-1)!;
  assert.equal(last.role, 'user');
  assert.equal(last.parts.length, 2, 'cached image should still be attached without fetching source URL');
  assert.equal((last.parts[1] as any).inline_data.mime_type, 'image/png');
  assert.equal((last.parts[1] as any).inline_data.data, ONE_BY_ONE_PNG.toString('base64'));
});

test('image URL validation blocks local addresses unless explicitly enabled', async () => {
  const oldValue = process.env.QQ_BOT_ALLOW_LOCAL_IMAGE_FETCH;
  delete process.env.QQ_BOT_ALLOW_LOCAL_IMAGE_FETCH;
  try {
    const result = await imageCache.validateImageUrl('http://127.0.0.1/private.png');
    assert.equal(result.ok, false);
  } finally {
    if (oldValue === undefined) {
      delete process.env.QQ_BOT_ALLOW_LOCAL_IMAGE_FETCH;
    } else {
      process.env.QQ_BOT_ALLOW_LOCAL_IMAGE_FETCH = oldValue;
    }
  }
});

test('default image allowlist includes NapCat QQ multimedia host', () => {
  assert.equal(imageCache.hostMatchesAllowedSuffix('multimedia.nt.qq.com.cn'), true);
  assert.equal(imageCache.hostMatchesAllowedSuffix('evil-nt.qq.com.cn.example.com'), false);
});

