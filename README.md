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

启用群白名单时，`active_groups` 为空会忽略所有群消息。

## AI Provider

Agent Runtime 可使用 Gemini `generateContent` 或 OpenAI `Responses API`。GPT-5.6 模型选项包括：

- `gpt-5.6-sol`：旗舰能力。
- `gpt-5.6-terra`：能力、延迟和成本更均衡。
- `gpt-5.6-luna`：面向高吞吐和低延迟任务。
- `gpt-5.6`：指向 Sol 的系列别名。

可以直接在管理面板的“设置 → 工具与模型”选择 `OpenAI Responses`，填写 Base URL、API Key、模型和 reasoning effort。也可以把密钥放在不会提交的 `.env` 中：

```bash
OPENAI_API_KEY=your-key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-5.6-sol
```

自定义兼容端点既可以填写服务根地址，也可以填写以 `/v1` 结尾的地址；运行时统一调用 `/v1/responses`。请求使用 `stream: true`，服务端会把 Responses SSE 增量事件还原为完整回复，因此也兼容强制流式输出的中转网关。OpenAI 工具调用会保留 `call_id`，并继续复用本项目的上下文压缩和持久化运行记录。

OpenAI Provider 还可以在设置页启用 Responses 内置 `web_search`。搜索由 OpenAI 托管，Bot 不会把它当作本地函数工具执行；最终回复会根据 `url_citation` 注解追加去重后的可点击来源。

对于已经知道具体 URL 的页面，可以另外启用 `web_fetch`。这是由本项目宿主执行的 OpenAI 函数工具，不会暴露给 Gemini：它只读取公开 HTTP(S) 文本内容，并限制重定向、超时、响应大小与内容类型；解析到回环、内网、链路本地地址的 URL 会在请求前被拒绝。

## Agent Runtime

QQ 消息由持久化 Agent Runtime 处理，而不是直接进行一次模型调用：

```text
OneBot event -> agent selection -> context budget -> model/tool loop
             -> direct tool execution -> QQ reply
```

内置 Agent：

- `assistant`：聊天、图片、记忆和只读查询。
- `group-manager`：群成员与群管理任务；由模型直接选择并调用工具。
- `summarizer`：无工具的会话压缩角色。

每次运行、工具调用、工具结果和压缩摘要都会持久化。SQLite 模式写入 `data/bot.db`；JSON 兼容模式写入 `data/agent-runtime.json`。服务重启时，未完成运行会被标记为 `interrupted`。

群管理工具不再经过 `/approve` 二次确认。配置中的管理员触发群管理请求后，由模型自行判断是否调用一个或多个工具；宿主仍会校验请求者身份、Bot 群权限以及目标成员是否可管理。

Agent 配置示例：

```json
{
  "agent_context_token_budget": 24000,
  "agent_output_token_reserve": 4096,
  "agent_recent_turns": 8,
  "agent_session_max_turns": 200,
  "agent_run_timeout_ms": 120000,
  "agent_tool_timeout_ms": 30000,
  "agent_tool_result_max_chars": 24000
}
```

运行记录 API：

- `GET /api/agent/agents`
- `GET /api/agent/runs`
- `GET /api/agent/runs/:id`
- `POST /api/agent/runs/:id/cancel`

## QQ 沙盒

登录管理面板后打开“运维 → QQ 沙盒”，可以在不连接 NapCat 的情况下测试私聊与群聊：

- 私聊直接进入真实 Agent Runtime。
- 群聊既可以 `@Bot` 触发 Agent，也可以只写入群聊背景，用于测试多成员上下文。
- 可以选择模拟发送者、引用消息，并观察 Agent、run ID 与当前 Provider。
- 群成员查询、禁言、解禁、踢人和全员禁言都走真实工具/权限链路，但只修改进程内的模拟 OneBot 状态。
- 沙盒消息、成员状态和群管理结果不会写入真实 QQ；重启服务或点击“重置沙盒”即可清空。

沙盒 API 均要求面板登录：

- `GET /api/sandbox`
- `POST /api/sandbox/messages`
- `POST /api/sandbox/reset`

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
