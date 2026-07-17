import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assistant } from '../../lib/server/agent/agents.js';
import { qqToolRegistry } from '../../lib/server/agent/tools.js';
import { executeWebFetch, validatePublicWebUrl } from '../../lib/server/agent/web-fetch.js';

test('web_fetch extracts readable HTML and strips executable page content', async () => {
  const fetched: string[] = [];
  const result = await executeWebFetch(
    { url: 'https://docs.example.test/guide#part' },
    undefined,
    {
      resolve: async () => ['203.0.113.10'],
      fetchImpl: async (url) => {
        fetched.push(String(url));
        return new Response(`
          <html><head><title>Agent &amp; Tools</title><style>.hidden{display:none}</style></head>
          <body><main><h1>Fetch guide</h1><p>Safe public content.</p><script>stealSecrets()</script></main></body></html>
        `, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      },
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.title, 'Agent & Tools');
  assert.match(String(result.text), /Fetch guide/);
  assert.match(String(result.text), /Safe public content/);
  assert.doesNotMatch(String(result.text), /stealSecrets|display:none/);
  assert.equal(fetched[0], 'https://docs.example.test/guide');
});

test('web_fetch blocks URLs resolving to private addresses before fetch', async () => {
  let fetchCalled = false;
  const validation = await validatePublicWebUrl('http://metadata.example.test/latest', async () => ['169.254.169.254']);
  assert.deepEqual(validation, { ok: false, error: '禁止访问内网、回环或链路本地地址' });

  const result = await executeWebFetch(
    { url: 'http://localhost:8001/api/config' },
    undefined,
    {
      resolve: async () => ['127.0.0.1'],
      fetchImpl: async () => {
        fetchCalled = true;
        return new Response('should not happen');
      },
    }
  );
  assert.equal(result.ok, false);
  assert.equal(fetchCalled, false);
});

test('web_fetch tool is exposed only for an enabled OpenAI channel', () => {
  const base = {
    event: { message_type: 'private', user_id: 1, self_id: 2 },
    client: {},
    conversationKey: 'private:1',
    agent: assistant,
    botRole: 'none',
    requesterIsAdmin: true,
  } as const;

  const openaiTools = qqToolRegistry.declarations({
    ...base,
    cfg: { ai_provider: 'openai', ai_web_fetch_enabled: true, ai_memory_enabled: false },
  });
  assert.ok(openaiTools.some((tool) => tool.name === 'web_fetch'));

  const disabledTools = qqToolRegistry.declarations({
    ...base,
    cfg: { ai_provider: 'openai', ai_web_fetch_enabled: false, ai_memory_enabled: false },
  });
  assert.ok(!disabledTools.some((tool) => tool.name === 'web_fetch'));

  const geminiTools = qqToolRegistry.declarations({
    ...base,
    cfg: { ai_provider: 'gemini', ai_web_fetch_enabled: true, ai_memory_enabled: false },
  });
  assert.ok(!geminiTools.some((tool) => tool.name === 'web_fetch'));
});
