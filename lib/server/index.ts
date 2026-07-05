// 主入口 —— 同时启动 OneBot WS 客户端和 Express 后端

import type { Server as HttpServer } from 'http';
import type { OneBotWSClient as OneBotWSClientType } from './ws-client.js';

import { installServerLogger, flushServerLogger } from './logger.js';
import { OneBotWSClient } from './ws-client.js';
import { loadConfig } from './config.js';
import { createServerApp } from './api.js';
import { SERVER_LOG_FILE } from './paths.js';

const PORT = Number(process.env.PORT || 8001);

installServerLogger();
const cfg = loadConfig();

function exitAfterFlush(code: number): void {
  flushServerLogger(() => process.exit(code));
}

function shutdown(httpServer: HttpServer, client: OneBotWSClientType, code = 0): void {
  client.stop();
  httpServer.close(() => exitAfterFlush(code));
  setTimeout(() => exitAfterFlush(code), 1000).unref();
}

async function main(): Promise<void> {
  // 启动 WS 客户端（后台自动重连）
  const client = new OneBotWSClient(cfg.napcat_ws);
  client.connect();

  // 启动 Express 后端；开发模式下 Vite HMR 复用同一个 HTTP server
  const { httpServer } = await createServerApp(client);
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[Logger] 日志写入: ${SERVER_LOG_FILE}`);
    console.log(`[Server] 运行在 http://0.0.0.0:${PORT}`);
    console.log(`[Server] WS 目标: ${cfg.napcat_ws}`);
    if (process.env.NODE_ENV === 'development' || process.env.QQ_BOT_VITE_DEV === '1') {
      console.log('[Server] Vite dev middleware 已启用，前端与后端共用此端口，HMR 复用当前 HTTP server');
    }
  });

  // 优雅退出
  process.on('SIGINT', () => {
    console.log('\n[Server] 收到退出信号，正在关闭...');
    shutdown(httpServer, client);
  });
  process.on('SIGTERM', () => {
    shutdown(httpServer, client);
  });
}

main().catch((err: unknown) => {
  console.error('[Server] 启动失败:', err);
  process.exit(1);
});
