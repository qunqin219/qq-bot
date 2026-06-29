# QQ Bot

基于 NapCat / OneBot 11 的 QQ 机器人与 Web 管理面板。

## 结构

- `server/`：Node.js + Express + WebSocket 后端，连接 NapCat OneBot 11
- `panel/`：React + Vite 管理面板

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
  "napcat_ws": "ws://127.0.0.1:3001"
}
```

## 启动

```bash
cd server
pnpm install
pnpm start
```

构建管理面板：

```bash
cd panel
pnpm install
pnpm build
```

## 测试

```bash
cd server
pnpm test
```
