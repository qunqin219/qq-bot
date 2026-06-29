const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const ai = require('../ai');
const imageCache = require('../image-cache');

const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

async function startImageServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/cached.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(ONE_BY_ONE_PNG);
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/cached.png`,
    close: () => new Promise((resolve) => server.close(resolve)),
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
  const last = body.contents.at(-1);
  assert.equal(last.role, 'user');
  assert.equal(last.parts.length, 2, 'cached image should still be attached without fetching source URL');
  assert.equal(last.parts[1].inline_data.mime_type, 'image/png');
  assert.equal(last.parts[1].inline_data.data, ONE_BY_ONE_PNG.toString('base64'));
});
