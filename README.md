# QQ Bot

基于 NapCat / OneBot 11 的 QQ 机器人与 Web 管理面板。

## 目录结构

项目按功能在根目录平铺组织，避免再套 `server/`、`panel/` 或 `apps/` 这类双入口目录：

```text
.
├── app/               # React 页面、布局和前端入口
├── components/        # 可复用前端组件
├── lib/
│   ├── api/           # 前端 API client
│   └── server/        # Express、OneBot、AI、存储等服务端逻辑
├── scripts/           # 运行、重启、调试脚本
├── styles/            # 全局样式
├── tests/             # 自动化测试
├── config.json        # 本地运行配置，忽略提交
├── data/              # 运行后生成的图片缓存和 session 文件，忽略提交
├── logs/              # server.log，忽略提交
├── index.html         # Vite HTML 入口
├── package.json       # 统一依赖和脚本
└── pnpm-workspace.yaml
```

## 本地配置

真实运行配置写在项目根目录的 `config.json`，该文件已被 `.gitignore` 忽略，不应提交到仓库。

面板登录相关配置也可以通过环境变量提供：

```bash
export QQ_BOT_PANEL_USERNAME=admin
export QQ_BOT_PANEL_PASSWORD='change-me'
export QQ_BOT_SESSION_SECRET='replace-with-a-long-random-string'
```

也可以在 `config.json` 中写入：

```json
{
  "panel_username": "admin",
  "panel_password": "change-me",
  "session_secret": "replace-with-a-long-random-string",
  "admins": [123456789],
  "napcat_ws": "ws://127.0.0.1:3001",
  "group_filter_enabled": true,
  "active_groups": [987654321]
}
```

启用群白名单时，`active_groups` 为空会忽略所有群消息。涉及禁言、解禁、踢人、全员禁言等群管理动作时，管理员消息需要包含“确认执行”或“确认禁言/确认踢出”等确认语，后端才会真正执行。

## 启动

```bash
pnpm install
pnpm dev
```

`pnpm dev` 会启动 Express，并在同一个服务里挂载 Vite dev middleware；前端和后端共用 `http://localhost:8001`，接口仍是 `/api/*`。如果 8001 被占用，可以临时指定端口：

```bash
PORT=18001 pnpm dev
```

`pnpm dev`、`pnpm start` 和 `pnpm panel:dev` 通过 `tsx` 直接运行 `lib/server/index.ts`。后端 TypeScript 构建检查：

```bash
pnpm server:build
```

构建管理面板：

```bash
pnpm panel:build
```

构建后端和管理面板：

```bash
pnpm build
```

开发管理面板：

```bash
pnpm panel:dev
```

后台运行和重启：

```bash
pnpm bot:restart
pnpm bot:status
pnpm bot:stop
```

## 测试

```bash
pnpm test
```

后端测试通过 Node test runner 和 `tsx` 直接运行 `tests/server/*.test.ts`。类型检查：

```bash
pnpm check
```

预览 AI 运行时：

```bash
pnpm preview:ai
```
