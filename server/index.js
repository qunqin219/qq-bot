// 主入口 —— 同时启动 OneBot WS 客户端和 Express 后端

const { OneBotWSClient } = require('./ws-client');
const { loadConfig } = require('./config');
const { setupApp } = require('./api');

const PORT = 8001;

const cfg = loadConfig();

// 启动 WS 客户端（后台自动重连）
const client = new OneBotWSClient(cfg.napcat_ws);
client.connect();

// 启动 Express 后端
const app = setupApp(client);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] 运行在 http://0.0.0.0:${PORT}`);
  console.log(`[Server] WS 目标: ${cfg.napcat_ws}`);
});

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n[Server] 收到退出信号，正在关闭...');
  client.stop();
  process.exit(0);
});
process.on('SIGTERM', () => {
  client.stop();
  process.exit(0);
});
