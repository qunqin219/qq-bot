// Express 后端 —— QQ Bot 控制面板 API + 静态前端托管

const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const { loadConfig, saveConfig } = require('./config');
const { getMessages, getChats } = require('./message-store');
const conversationStore = require('./conversation-store');
const memoryStore = require('./memory-store');

// ── 前端静态资源目录（vite build 产物） ────────────────────
const PANEL_DIST = path.join(__dirname, '..', 'panel', 'dist');
const SERVER_LOG_FILE = path.join(__dirname, '..', 'logs', 'server.log');

function readTailLines(filePath, lineLimit = 300, maxBytes = 512 * 1024) {
  if (!fs.existsSync(filePath)) return [];
  const stat = fs.statSync(filePath);
  const bytesToRead = Math.min(stat.size, maxBytes);
  const start = Math.max(0, stat.size - bytesToRead);
  const buffer = Buffer.alloc(bytesToRead);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buffer, 0, bytesToRead, start);
  } finally {
    fs.closeSync(fd);
  }
  const text = buffer.toString('utf8');
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  return lines.slice(-lineLimit);
}

// ── 认证配置 ──────────────────────────────────────────────
const ADMIN_USERNAME = 'qunqin';
const ADMIN_PASSWORD = 'CHANGE_ME_PANEL_PASSWORD';
const SESSION_SECRET_KEY = 'CHANGE_ME_SESSION_SECRET';

function isValidHttpUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// ── 全局 WS 客户端实例（由 setupApp 注入） ────────────────
let wsClient = null;

/**
 * 创建并配置 Express 应用。
 * @param {object} client - OneBotWSClient 实例
 */
function setupApp(client) {
  wsClient = client;

  const app = express();

  // ── 中间件 ──────────────────────────────────────────
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(
    cors({
      origin: [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://qq.qunqin.org',
        'https://qq.qunqin.org',
      ],
      credentials: true,
    })
  );
  app.use(
    session({
      secret: SESSION_SECRET_KEY,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24, // 1 天
        sameSite: 'lax',
      },
    })
  );

  // ── 认证中间件 ──────────────────────────────────────
  function requireAuth(req, res, next) {
    if (!req.session.user) {
      return res.status(401).json({ detail: '未登录' });
    }
    next();
  }

  // ── 认证端点 ────────────────────────────────────────
  app.post('/api/login', (req, res) => {
    const { username, password } = req.body || {};
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      req.session.user = username;
      return res.json({ ok: true, user: username });
    }
    return res.status(401).json({ detail: '用户名或密码错误' });
  });

  app.post('/api/logout', (req, res) => {
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.json({ ok: true });
    });
  });

  app.get('/api/me', (req, res) => {
    const user = req.session.user;
    if (user) {
      return res.json({ authenticated: true, user });
    }
    return res.json({ authenticated: false });
  });

  // ── 业务端点（均需认证） ────────────────────────────
  app.get('/api/status', requireAuth, async (req, res) => {
    // 获取 bot 状态：登录信息 + 连接状态 + 群列表预览
    let loginInfo = null;
    let groups = [];
    let connected = false;

    if (wsClient) {
      connected = wsClient.connected;
      if (connected) {
        loginInfo = await wsClient.getLoginInfo();
        const groupsResp = await wsClient.getGroupList();
        groups = (groupsResp && groupsResp.data) || [];
      }
    }

    const loginData = (loginInfo && loginInfo.data) || {};
    return res.json({
      connected,
      login: {
        user_id: loginData.user_id,
        nickname: loginData.nickname,
      },
      groups,
      group_count: groups.length,
    });
  });

  app.get('/api/config', requireAuth, (req, res) => {
    res.json(loadConfig());
  });

  app.put('/api/config', requireAuth, (req, res) => {
    // 部分字段更新
    const cfg = loadConfig();
    const update = {};
    const body = req.body || {};
    const allowedKeys = [
      'admins',
      'command_prefix',
      'napcat_ws',
      'active_groups',
      'group_filter_enabled',
      // AI 回复配置
      'ai_enabled',
      'ai_base_url',
      'ai_api_key',
      'ai_model',
      'ai_system_prompt',
      'ai_context_enabled',
      'ai_context_turns',
      'ai_thinking_enabled',
      'ai_thinking_level',
      'ai_google_search_enabled',
      'ai_url_context_enabled',
      'ai_allow_group_mention_from_non_admin',
      'ai_group_context_enabled',
      'ai_group_context_messages',
      'ai_group_context_include_quote',
      'ai_group_context_exclude_bot',
      'ai_filter_stickers',
      'ai_group_reply_quote_enabled',
      'ai_group_reply_quote_prefer_quoted',
      'ai_memory_enabled',
    ];
    for (const key of allowedKeys) {
      if (body[key] !== undefined) {
        update[key] = body[key];
      }
    }
    if (update.ai_base_url !== undefined && !isValidHttpUrl(update.ai_base_url)) {
      return res.status(400).json({ detail: 'AI Base URL 必须是完整的 http(s) 地址，疑似被浏览器自动填充污染，已拒绝保存' });
    }
    if (update.ai_api_key !== undefined && String(update.ai_api_key || '') === ADMIN_PASSWORD) {
      return res.status(400).json({ detail: 'API Key 疑似被浏览器自动填充成面板密码，已拒绝保存' });
    }
    Object.assign(cfg, update);
    saveConfig(cfg);
    return res.json({ ok: true, config: cfg });
  });

  app.post('/api/send-group', requireAuth, async (req, res) => {
    const { group_id, message } = req.body || {};
    if (!wsClient || !wsClient.connected) {
      return res.status(503).json({ detail: 'Bot 未连接 NapCat' });
    }
    const result = await wsClient.sendGroupMsg(group_id, message);
    const ok = result && result.status === 'ok';
    if (!ok) {
      return res.status(502).json({
        detail: `发送失败: ${(result && result.msg) || JSON.stringify(result)}`,
      });
    }
    return res.json({ ok: true, result });
  });

  app.post('/api/send-private', requireAuth, async (req, res) => {
    const { user_id, message } = req.body || {};
    if (!wsClient || !wsClient.connected) {
      return res.status(503).json({ detail: 'Bot 未连接 NapCat' });
    }
    const result = await wsClient.sendPrivateMsg(user_id, message);
    const ok = result && result.status === 'ok';
    if (!ok) {
      return res.status(502).json({
        detail: `发送失败: ${(result && result.msg) || JSON.stringify(result)}`,
      });
    }
    return res.json({ ok: true, result });
  });

  app.get('/api/messages', requireAuth, (req, res) => {
    // 支持 limit / user_id / group_id 查询参数
    const limit = parseInt(req.query.limit, 10) || 50;
    const userId =
      req.query.user_id !== undefined
        ? Number(req.query.user_id)
        : null;
    const groupId =
      req.query.group_id !== undefined
        ? Number(req.query.group_id)
        : null;
    const msgs = getMessages(limit, userId, groupId);
    return res.json({ messages: msgs, total: msgs.length });
  });

  app.get('/api/chats', requireAuth, (req, res) => {
    const chats = getChats();
    return res.json({ chats, total: chats.length });
  });

  app.get('/api/conversations', requireAuth, (req, res) => {
    const conversations = conversationStore.listHistories();
    return res.json({ conversations, total: conversations.length });
  });

  app.delete('/api/conversations/:key', requireAuth, (req, res) => {
    const key = decodeURIComponent(req.params.key || '');
    conversationStore.clearHistory(key);
    return res.json({ ok: true });
  });

  app.delete('/api/conversations', requireAuth, (req, res) => {
    conversationStore.clearAllHistories();
    return res.json({ ok: true });
  });

  app.get('/api/memories', requireAuth, (req, res) => {
    const key = String(req.query.key || '').trim();
    if (key) {
      const memories = memoryStore.getForConversation(key);
      return res.json({ memories, total: memories.length, key });
    }
    const memories = memoryStore.getAll();
    return res.json({ memories, total: memories.length, summaries: memoryStore.listSummaries() });
  });

  app.post('/api/memories', requireAuth, (req, res) => {
    const key = String(req.body?.key || '').trim();
    const content = String(req.body?.content || '').trim();
    const memory = memoryStore.add(key, content);
    if (!memory) return res.status(400).json({ detail: 'key 和 content 不能为空' });
    return res.json({ ok: true, memory });
  });

  app.put('/api/memories/:id', requireAuth, (req, res) => {
    const id = Number(req.params.id || 0);
    const key = String(req.body?.key || '').trim();
    const content = String(req.body?.content || '').trim();
    const memory = memoryStore.update(key, id, content);
    if (!memory) return res.status(404).json({ detail: '未找到对应会话下的记忆' });
    return res.json({ ok: true, memory });
  });

  app.delete('/api/memories/:id', requireAuth, (req, res) => {
    const id = Number(req.params.id || 0);
    const key = String(req.query.key || req.body?.key || '').trim();
    const ok = memoryStore.remove(key, id);
    if (!ok) return res.status(404).json({ detail: '未找到对应会话下的记忆' });
    return res.json({ ok: true });
  });

  app.delete('/api/memories', requireAuth, (req, res) => {
    const key = String(req.query.key || '').trim();
    if (key) {
      memoryStore.deleteForConversation(key);
      return res.json({ ok: true, key });
    }
    memoryStore.clearAll();
    return res.json({ ok: true });
  });

  app.get('/api/groups', requireAuth, async (req, res) => {
    // 从 ws_client 实时获取群列表
    if (!wsClient || !wsClient.connected) {
      return res.json({ groups: [], total: 0, connected: false });
    }
    const resp = await wsClient.getGroupList();
    const groups = (resp && resp.data) || [];
    return res.json({ groups, total: groups.length, connected: true });
  });

  app.get('/api/logs', requireAuth, (req, res) => {
    const limit = Math.max(20, Math.min(2000, parseInt(req.query.limit, 10) || 300));
    const query = String(req.query.q || '').trim().toLowerCase();
    let lines = readTailLines(SERVER_LOG_FILE, limit, 1024 * 1024);
    if (query) {
      lines = lines.filter((line) => line.toLowerCase().includes(query));
    }
    const stat = fs.existsSync(SERVER_LOG_FILE) ? fs.statSync(SERVER_LOG_FILE) : null;
    return res.json({
      lines,
      total: lines.length,
      limit,
      query,
      file: SERVER_LOG_FILE,
      size: stat?.size || 0,
      modified_at: stat ? stat.mtime.toISOString() : null,
    });
  });

  // ── 前端静态文件 / SPA 路由 ─────────────────────────
  // 静态资源从 panel/dist serve
  if (fs.existsSync(PANEL_DIST)) {
    app.use(express.static(PANEL_DIST));

    // SPA catch-all：非 /api 的 GET 请求返回 index.html
    app.get(/^\/(?!api).*/, (req, res, _next) => {
      const indexPath = path.join(PANEL_DIST, 'index.html');
      if (fs.existsSync(indexPath)) {
        return res.sendFile(indexPath);
      }
      return res.status(404).json({ detail: '前端未构建' });
    });
  } else {
    // 前端未构建，返回基础信息
    app.get('/', (req, res) => {
      res.json({ status: 'ok', service: 'QQ Bot 管理面板 API（前端未构建）' });
    });
  }

  return app;
}

module.exports = { setupApp };
