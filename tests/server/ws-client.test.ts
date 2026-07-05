import type { AddressInfo } from 'node:net';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WebSocketServer, type WebSocket } from 'ws';

import { OneBotWSClient } from '../../lib/server/ws-client.js';

// ws-client 的 callApi 内部总会排一个 10s 超时定时器，断线重连也用 setTimeout。
// 让这些定时器 unref，避免它们在测试结束后仍把进程拖住（实测 node:test 会等定时器）。
const _nativeSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = ((fn: any, ms?: any, ...args: any[]) => {
  const handle = _nativeSetTimeout(fn, ms, ...args);
  try {
    (handle as any).unref?.();
  } catch {
    // 非定时器句柄时忽略
  }
  return handle;
}) as typeof globalThis.setTimeout;

type ServerHandle = {
  url: string;
  wss: WebSocketServer;
  close: () => Promise<void>;
};

function startServer(onConnect?: (socket: WebSocket) => void): Promise<ServerHandle> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 });
    wss.on('connection', (socket) => onConnect?.(socket));
    wss.on('listening', () => {
      const { port } = wss.address() as AddressInfo;
      resolve({
        url: `ws://127.0.0.1:${port}`,
        wss,
        close: async () => {
          for (const c of wss.clients) {
            try {
              c.close();
            } catch {
              // ignore
            }
          }
          await new Promise<void>((r) => wss.close(() => r()));
        },
      });
    });
  });
}

async function waitFor(label: string, predicate: () => boolean, timeoutMs = 3000, interval = 20): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise<void>((r) => setTimeout(r, interval));
  }
  throw new Error(`waitFor(${label}) timed out after ${timeoutMs}ms`);
}

test('callApi 发送请求并按 echo 匹配成功响应', async () => {
  const server = await startServer((socket) => {
    socket.on('message', (raw) => {
      const req = JSON.parse(raw.toString());
      socket.send(JSON.stringify({ status: 'ok', retcode: 0, data: { user_id: 123, nickname: 'NapCat' }, echo: req.echo }));
    });
  });

  const client = new OneBotWSClient(server.url);
  client.connect();
  try {
    await waitFor('connect', () => client.connected);

    const res = await client.callApi('get_login_info');

    assert.equal(res.status, 'ok');
    assert.equal(res.echo && res.echo.length > 0, true);
    assert.equal(res.data.user_id, 123);
    assert.equal(res.data.nickname, 'NapCat');
    // 响应被消费后，对应回调应已从 Map 中删除
    assert.equal(client.callbacks.size, 0);
  } finally {
    client.stop();
    await server.close();
  }
});

test('callApi 多个并发请求按 echo 各自正确路由', async () => {
  const received: Array<{ action: string; echo: string }> = [];
  let responder: WebSocket | undefined;
  const server = await startServer((socket) => {
    responder = socket;
    socket.on('message', (raw) => {
      const req = JSON.parse(raw.toString());
      received.push({ action: req.action, echo: req.echo });
      if (received.length === 2) {
        // 故意乱序回复：先回第二个请求，再回第一个
        socket.send(JSON.stringify({ status: 'ok', data: { seq: received[1].action }, echo: received[1].echo }));
        socket.send(JSON.stringify({ status: 'ok', data: { seq: received[0].action }, echo: received[0].echo }));
      }
    });
  });

  const client = new OneBotWSClient(server.url);
  client.connect();
  try {
    await waitFor('connect', () => client.connected);

    const [login, groups] = await Promise.all([
      client.callApi('get_login_info'),
      client.callApi('get_group_list'),
    ]);

    assert.ok(responder, 'server socket should exist');
    assert.equal(received.length, 2);
    assert.equal(received[0].action, 'get_login_info');
    assert.equal(received[1].action, 'get_group_list');

    // 即使服务端乱序回复，每个 Promise 也只拿到属于自己的 echo 响应
    assert.equal(login.status, 'ok');
    assert.equal(login.data.seq, 'get_login_info');
    assert.equal(groups.status, 'ok');
    assert.equal(groups.data.seq, 'get_group_list');
    assert.equal(client.callbacks.size, 0);
  } finally {
    client.stop();
    await server.close();
  }
});

test('callApi 在未连接时立即返回 failed/not connected', async () => {
  // 不调用 connect()，ws 始终为 null
  const client = new OneBotWSClient('ws://127.0.0.1:1');

  const res = await client.callApi('get_login_info');

  assert.equal(res.status, 'failed');
  assert.equal(res.msg, 'not connected');
  assert.equal(client.callbacks.size, 0);
});

test('收到带 post_type 的事件会分发给 bot-core.handleEvent', async () => {
  let pushSocket: WebSocket | undefined;
  const server = await startServer((socket) => {
    pushSocket = socket;
  });

  const client = new OneBotWSClient(server.url);
  client.connect();
  try {
    await waitFor('connect', () => client.connected);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
    };
    try {
      // user_id === self_id：handleEvent 会在打印日志后于“忽略自身消息”处提前返回，
      // 既证明事件被分发到了 handleEvent（该日志只来自 handleEvent 内部），又不触发落盘/AI 副作用。
      pushSocket!.send(JSON.stringify({
        post_type: 'message',
        message_type: 'private',
        sub_type: 'friend',
        user_id: 555,
        self_id: 555,
        message_id: 9001,
        raw_message: 'hello self',
      }));

      await waitFor('handleEvent log', () => logs.some((l) => l.includes('[BotCore] 收到消息')), 2000);
    } finally {
      console.log = origLog;
    }

    assert.ok(logs.some((l) => l.includes('[BotCore] 收到消息')), '事件应被分发到 bot-core.handleEvent');
    // 带有 post_type 的消息不应进入 API 回调路径
    assert.equal(client.callbacks.size, 0);
  } finally {
    client.stop();
    await server.close();
  }
});

test('断线时清理挂起回调，并在 5 秒后自动重连', async () => {
  let firstSocket: WebSocket | undefined;
  let connections = 0;
  const server = await startServer((socket) => {
    connections += 1;
    if (connections === 1) firstSocket = socket;
  });

  const client = new OneBotWSClient(server.url);
  client.connect();
  try {
    await waitFor('connect', () => client.connected);
    assert.equal(connections, 1);

    // 手工注册一个挂起回调（等价于 callApi 内部行为，但不引入 callApi 自身的 10s 定时器）
    let resolved: { status?: string; msg?: string } | undefined;
    const echo = 'pending-echo';
    client.callbacks.set(echo, {
      resolve: (v) => {
        resolved = v;
      },
      reject: () => {},
    });

    // 服务端强制断开连接
    firstSocket!.terminate();

    // 断线应触发 _cleanupCallbacks，把挂起回调 resolve 为 failed/disconnected
    await waitFor('cleanup', () => resolved !== undefined, 2000);
    assert.equal(resolved!.status, 'failed');
    assert.equal(resolved!.msg, 'disconnected');
    assert.equal(client.callbacks.has(echo), false);
    await waitFor('disconnected flag', () => client.connected === false, 2000);

    // 约 5 秒后自动重连，服务端出现第二次 connection
    await waitFor('reconnect', () => connections >= 2, 8000);
    assert.equal(connections, 2);
    await waitFor('reconnected flag', () => client.connected, 2000);
  } finally {
    // 在已连接（ws open）状态下停止，避免再排一个重连定时器
    client.stop();
    await server.close();
  }
});
