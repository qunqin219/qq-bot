import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createServerApp } from '../../lib/server/api.js';
import { DEFAULT_CONFIG, loadConfig, saveConfig } from '../../lib/server/config.js';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-bot-api-test-'));
process.env.QQ_BOT_CONFIG_FILE = path.join(tempRoot, 'config.json');
process.env.QQ_BOT_STORE_BACKEND = 'json';
process.env.QQ_BOT_MESSAGES_FILE = path.join(tempRoot, 'messages.json');
process.env.QQ_BOT_CONVERSATIONS_FILE = path.join(tempRoot, 'conversations.json');
process.env.QQ_BOT_MEMORIES_FILE = path.join(tempRoot, 'memories.json');
process.env.QQ_BOT_IMAGE_CACHE_DIR = path.join(tempRoot, 'images');
process.env.QQ_BOT_SESSIONS_FILE = path.join(tempRoot, 'sessions.json');
process.env.QQ_BOT_COOKIE_SECURE = '0';
process.env.QQ_BOT_PANEL_USERNAME = 'admin';
process.env.QQ_BOT_PANEL_PASSWORD = 'panel-secret';
process.env.QQ_BOT_SESSION_SECRET = 'test-session-secret-that-is-long-enough';

type RequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  cookie?: string;
};

type JsonResponse = {
  status: number;
  data: any;
  cookie: string;
};

async function withServer(fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const client = { connected: false };
  const { httpServer } = await createServerApp(client as any);
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
  const { port } = httpServer.address() as { port: number };
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => httpServer.close((err) => (err ? reject(err) : resolve())));
  }
}

async function request(baseUrl: string, urlPath: string, options: RequestOptions = {}): Promise<JsonResponse> {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.cookie) headers.cookie = options.cookie;
  const resp = await fetch(`${baseUrl}${urlPath}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const data = await resp.json().catch(() => null);
  return {
    status: resp.status,
    data,
    cookie: resp.headers.get('set-cookie')?.split(';')[0] || '',
  };
}

test('config API sanitizes secrets and preserves API key on empty update', async () => {
  saveConfig({
    ...DEFAULT_CONFIG,
    panel_username: 'admin',
    panel_password: 'panel-secret',
    session_secret: 'file-session-secret',
    ai_api_key: 'sk-real-secret',
    ai_base_url: 'https://generativelanguage.googleapis.com/v1beta',
  });

  await withServer(async (baseUrl) => {
    const login = await request(baseUrl, '/api/login', {
      method: 'POST',
      body: { username: 'admin', password: 'panel-secret' },
    });
    assert.equal(login.status, 200);
    assert.ok(login.cookie);

    const config = await request(baseUrl, '/api/config', { cookie: login.cookie });
    assert.equal(config.status, 200);
    assert.equal(Object.hasOwn(config.data, 'panel_password'), false);
    assert.equal(Object.hasOwn(config.data, 'session_secret'), false);
    assert.equal(config.data.ai_api_key, '');
    assert.equal(config.data.ai_api_key_configured, true);
    assert.equal(config.data.ai_api_key_last4, 'cret');

    const preserved = await request(baseUrl, '/api/config', {
      method: 'PUT',
      cookie: login.cookie,
      body: { ai_model: 'gemini-test', ai_api_key: '' },
    });
    assert.equal(preserved.status, 200);
    assert.equal(loadConfig().ai_api_key, 'sk-real-secret');
    assert.equal(preserved.data.config.ai_api_key, '');

    const changed = await request(baseUrl, '/api/config', {
      method: 'PUT',
      cookie: login.cookie,
      body: { ai_api_key: 'sk-new-secret' },
    });
    assert.equal(changed.status, 200);
    assert.equal(loadConfig().ai_api_key, 'sk-new-secret');
    assert.equal(changed.data.config.ai_api_key_last4, 'cret');

    const cleared = await request(baseUrl, '/api/config', {
      method: 'PUT',
      cookie: login.cookie,
      body: { ai_api_key_clear: true },
    });
    assert.equal(cleared.status, 200);
    assert.equal(loadConfig().ai_api_key, '');
    assert.equal(cleared.data.config.ai_api_key_configured, false);
  });
});

