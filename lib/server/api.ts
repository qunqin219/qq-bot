// Express 后端 —— QQ Bot 控制面板 API + 静态前端托管

import type { Express, NextFunction, Request, Response } from 'express';
import type { Server as HttpServer } from 'http';
import type { Session, SessionData } from 'express-session';
import type { OneBotWSClient } from './ws-client.js';

declare module 'express-session' {
  interface SessionData {
    user?: string;
  }
}

import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import http from 'http';
import express from 'express';
import session from 'express-session';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import { loadConfig, saveConfig } from './config.js';
import { messageStore, conversationStore, memoryStore } from './store/index.js';
import { FileSessionStore } from './session-store.js';
import { agentRunStore } from './agent/store/index.js';
import { listAgents } from './agent/agents.js';
import { cancelRun } from './agent/run-controller.js';
import { resolveApproval } from './agent/runner.js';
import { qqSandbox, SandboxRequestError } from './sandbox.js';
import {
  CONFIG_FILE,
  CONVERSATIONS_FILE,
  DATA_DIR,
  INDEX_HTML,
  LOG_DIR,
  MEMORIES_FILE,
  MESSAGES_FILE,
  PANEL_DIST,
  SERVER_LOG_FILE,
  SESSIONS_FILE,
} from './paths.js';

type ConfigRecord = Record<string, any>;

type LoginAttempt = {
  count: number;
  resetAt: number;
};

type ConfigureOptions = {
  httpServer?: HttpServer;
};

type PanelSession = Session & Partial<SessionData> & {
  user?: string;
};

type PanelRequest = Request & {
  session: PanelSession;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ── 前端静态资源目录（vite build 产物） ────────────────────

function readTailLines(filePath: string, lineLimit = 300, maxBytes = 512 * 1024): string[] {
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

function collapseAdjacentDuplicateLines(lines: string[]): string[] {
  const result: string[] = [];
  for (const line of lines) {
    if (result[result.length - 1] === line) continue;
    result.push(line);
  }
  return result;
}

// ── 认证配置 ──────────────────────────────────────────────
const FALLBACK_SESSION_SECRET = crypto.randomBytes(32).toString('hex');
const ALLOWED_CORS_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://qq.qunqin.org',
  'https://qq.qunqin.org',
];

function getPanelAuthConfig(): { username: string; password: string; sessionSecret: string } {
  const cfg = loadConfig();
  return {
    username: process.env.QQ_BOT_PANEL_USERNAME || cfg.panel_username || 'admin',
    password: process.env.QQ_BOT_PANEL_PASSWORD || cfg.panel_password || '',
    sessionSecret: process.env.QQ_BOT_SESSION_SECRET || cfg.session_secret || FALLBACK_SESSION_SECRET,
  };
}

function secretMetadata(value: unknown): { configured: boolean; last4: string; length: number } {
  const text = String(value || '').trim();
  return {
    configured: Boolean(text),
    last4: text ? text.slice(-4) : '',
    length: text.length,
  };
}

function sanitizeConfigForClient(cfg: ConfigRecord): ConfigRecord {
  const configuredAiKey = String(cfg.ai_api_key || '').trim();
  const environmentAiKey = String(cfg.ai_provider === 'openai' ? process.env.OPENAI_API_KEY || '' : '').trim();
  const aiKey = secretMetadata(configuredAiKey || environmentAiKey);
  const panelPassword = secretMetadata(process.env.QQ_BOT_PANEL_PASSWORD || cfg.panel_password);
  const sessionSecret = secretMetadata(process.env.QQ_BOT_SESSION_SECRET || cfg.session_secret);
  const safe = { ...cfg };
  delete safe.panel_password;
  delete safe.session_secret;
  safe.ai_api_key = '';
  safe.ai_api_key_configured = aiKey.configured;
  safe.ai_api_key_last4 = aiKey.last4;
  safe.ai_api_key_length = aiKey.length;
  safe.ai_api_key_source = configuredAiKey ? 'config' : (environmentAiKey ? 'environment' : '');
  safe.panel_password_configured = panelPassword.configured;
  safe.session_secret_configured = sessionSecret.configured;
  return safe;
}

function isValidHttpUrl(value: unknown): boolean {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// ── 全局 WS 客户端实例（由 setupApp 注入） ────────────────
let wsClient: OneBotWSClient | null = null;

function isViteDevEnabled(): boolean {
  return process.env.NODE_ENV === 'development' || process.env.QQ_BOT_VITE_DEV === '1';
}

function isRuntimeDataPath(filePath: string): boolean {
  const runtimePaths = [
    CONFIG_FILE,
    CONVERSATIONS_FILE,
    DATA_DIR,
    LOG_DIR,
    MEMORIES_FILE,
    MESSAGES_FILE,
    SERVER_LOG_FILE,
    SESSIONS_FILE,
  ].map((runtimePath) => path.resolve(runtimePath));
  const resolved = path.resolve(filePath);
  return runtimePaths.some((runtimePath) => {
    return resolved === runtimePath || resolved.startsWith(`${runtimePath}${path.sep}`);
  });
}

function shouldUseSecureCookie(): boolean {
  if (process.env.QQ_BOT_COOKIE_SECURE !== undefined) {
    return process.env.QQ_BOT_COOKIE_SECURE === '1' || process.env.QQ_BOT_COOKIE_SECURE === 'true';
  }
  return process.env.NODE_ENV === 'production';
}

function shouldTrustProxy(): boolean {
  if (process.env.QQ_BOT_TRUST_PROXY !== undefined) {
    return process.env.QQ_BOT_TRUST_PROXY === '1' || process.env.QQ_BOT_TRUST_PROXY === 'true';
  }
  return process.env.NODE_ENV === 'production';
}

function sameOriginForRequest(req: Request): string | null {
  const host = req.get('host');
  if (!host) return null;
  return `${req.protocol}://${host}`;
}

function isAllowedRequestOrigin(req: Request): boolean {
  const origin = req.get('origin');
  if (!origin) return true;
  return origin === sameOriginForRequest(req) || ALLOWED_CORS_ORIGINS.includes(origin);
}

function verifyStateChangingOrigin(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!isAllowedRequestOrigin(req)) {
    return res.status(403).json({ detail: '请求来源不被允许' });
  }
  return next();
}

function createLoginRateLimiter() {
  const attempts = new Map<string, LoginAttempt>();
  const windowMs = Math.max(60_000, Number(process.env.QQ_BOT_LOGIN_RATE_WINDOW_MS || 15 * 60_000));
  const maxAttempts = Math.max(3, Number(process.env.QQ_BOT_LOGIN_RATE_MAX || 10));
  return {
    middleware(req: Request, res: Response, next: NextFunction) {
      const key = `${req.ip || req.socket?.remoteAddress || 'unknown'}:${String(req.body?.username || '')}`;
      const now = Date.now();
      const current = attempts.get(key);
      if (!current || current.resetAt <= now) {
        attempts.set(key, { count: 1, resetAt: now + windowMs });
        return next();
      }
      if (current.count >= maxAttempts) {
        return res.status(429).json({ detail: '登录失败次数过多，请稍后再试' });
      }
      current.count += 1;
      attempts.set(key, current);
      return next();
    },
    reset(req: Request) {
      const key = `${req.ip || req.socket?.remoteAddress || 'unknown'}:${String(req.body?.username || '')}`;
      attempts.delete(key);
    },
  };
}

async function mountViteDevServer(app: Express, httpServer?: HttpServer) {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    appType: 'custom',
    server: {
      middlewareMode: true,
      hmr: httpServer ? { server: httpServer } : undefined,
      watch: {
        ignored: isRuntimeDataPath,
      },
    },
  });

  app.use(vite.middlewares);

  app.get(/^\/(?!api).*/, async (req, res, next) => {
    try {
      let template = fs.readFileSync(INDEX_HTML, 'utf-8');
      template = await vite.transformIndexHtml(req.originalUrl, template);
      return res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      vite.ssrFixStacktrace(err);
      return next(err);
    }
  });
}

function mountBuiltPanel(app: Express) {
  // 静态资源从根目录 dist serve
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
}

/**
 * 创建并配置 Express 应用。
 * @param {import('express').Express} app - Express 应用
 * @param {object} client - OneBotWSClient 实例
 * @param {object} [options]
 * @param {import('http').Server} [options.httpServer] - 供 Vite HMR 复用的 HTTP server
 */
async function configureApp(app: Express, client: OneBotWSClient, options: ConfigureOptions = {}) {
  wsClient = client;
  const loginLimiter = createLoginRateLimiter();

  // ── 中间件 ──────────────────────────────────────────
  if (shouldTrustProxy()) app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());
  app.use(
    cors({
      origin: ALLOWED_CORS_ORIGINS,
      credentials: true,
    })
  );
  app.use(verifyStateChangingOrigin);
  app.use(
    session({
      name: 'qqbot.sid',
      secret: getPanelAuthConfig().sessionSecret,
      store: new FileSessionStore(SESSIONS_FILE),
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24, // 1 天
        sameSite: 'lax',
        secure: shouldUseSecureCookie(),
      },
    })
  );

  // ── 认证中间件 ──────────────────────────────────────
  function requireAuth(req: Request, res: Response, next: NextFunction) {
    const panelReq = req as PanelRequest;
    if (!panelReq.session.user) {
      return res.status(401).json({ detail: '未登录' });
    }
    next();
  }

  // ── 认证端点 ────────────────────────────────────────
  app.post('/api/login', loginLimiter.middleware, (req, res, next) => {
    const panelReq = req as PanelRequest;
    const { username, password } = req.body || {};
    const auth = getPanelAuthConfig();
    if (!auth.password) {
      return res.status(503).json({ detail: '面板密码未配置' });
    }
    if (username === auth.username && password === auth.password) {
      loginLimiter.reset(req);
      return panelReq.session.regenerate((err: unknown) => {
        if (err) return next(err);
        panelReq.session.user = username;
        return res.json({ ok: true, user: username });
      });
    }
    return res.status(401).json({ detail: '用户名或密码错误' });
  });

  app.post('/api/logout', (req, res) => {
    const panelReq = req as PanelRequest;
    panelReq.session.destroy(() => {
      res.clearCookie('qqbot.sid');
      res.json({ ok: true });
    });
  });

  app.get('/api/me', (req, res) => {
    const user = (req as PanelRequest).session.user;
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
    res.json(sanitizeConfigForClient(loadConfig()));
  });

  app.put('/api/config', requireAuth, (req, res) => {
    // 部分字段更新
    const cfg = loadConfig();
    const update: ConfigRecord = {};
    const body = req.body || {};
    const allowedKeys = [
      'admins',
      'command_prefix',
      'napcat_ws',
      'active_groups',
      'group_filter_enabled',
      // AI 回复配置
      'ai_enabled',
      'ai_provider',
      'ai_base_url',
      'ai_model',
      'ai_system_prompt',
      'ai_context_enabled',
      'ai_context_turns',
      'ai_thinking_enabled',
      'ai_thinking_level',
      'ai_google_search_enabled',
      'ai_url_context_enabled',
      'ai_web_search_enabled',
      'ai_web_search_context_size',
      'ai_web_fetch_enabled',
      'ai_allow_group_mention_from_non_admin',
      'ai_group_context_enabled',
      'ai_group_context_messages',
      'ai_group_context_include_quote',
      'ai_group_context_exclude_bot',
      'ai_filter_stickers',
      'ai_group_reply_quote_enabled',
      'ai_group_reply_quote_prefer_quoted',
      'ai_memory_enabled',
      // Agent Runtime
      'agent_context_token_budget',
      'agent_output_token_reserve',
      'agent_recent_turns',
      'agent_session_max_turns',
      'agent_max_tool_calls',
      'agent_run_timeout_ms',
      'agent_tool_timeout_ms',
      'agent_tool_result_max_chars',
      'agent_approval_ttl_ms',
      'agent_tool_permissions',
    ];
    for (const key of allowedKeys) {
      if (body[key] !== undefined) {
        update[key] = body[key];
      }
    }
    if (update.ai_base_url !== undefined && !isValidHttpUrl(update.ai_base_url)) {
      return res.status(400).json({ detail: 'AI Base URL 必须是完整的 http(s) 地址，疑似被浏览器自动填充污染，已拒绝保存' });
    }
    const panelPassword = getPanelAuthConfig().password;
    if (body.ai_api_key_clear === true) {
      update.ai_api_key = '';
    } else if (body.ai_api_key !== undefined) {
      const nextApiKey = String(body.ai_api_key || '').trim();
      if (nextApiKey) {
        update.ai_api_key = nextApiKey;
      }
    }
    if (update.ai_api_key !== undefined && panelPassword && String(update.ai_api_key || '') === panelPassword) {
      return res.status(400).json({ detail: 'API Key 疑似被浏览器自动填充成面板密码，已拒绝保存' });
    }
    Object.assign(cfg, update);
    saveConfig(cfg);
    return res.json({ ok: true, config: sanitizeConfigForClient(cfg) });
  });

  app.post('/api/send-group', requireAuth, async (req, res) => {
    const { group_id, message } = req.body || {};
    if (!Number.isFinite(Number(group_id)) || !String(message || '').trim()) {
      return res.status(400).json({ detail: 'group_id 和 message 不能为空' });
    }
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
    if (!Number.isFinite(Number(user_id)) || !String(message || '').trim()) {
      return res.status(400).json({ detail: 'user_id 和 message 不能为空' });
    }
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
    const limit = parseInt(String(req.query.limit || ''), 10) || 50;
    const userId =
      req.query.user_id !== undefined
        ? Number(req.query.user_id)
        : null;
    const groupId =
      req.query.group_id !== undefined
        ? Number(req.query.group_id)
        : null;
    const msgs = messageStore.getMessages(limit, userId, groupId);
    return res.json({ messages: msgs, total: msgs.length });
  });

  app.get('/api/chats', requireAuth, (req, res) => {
    const chats = messageStore.getChats();
    return res.json({ chats, total: chats.length });
  });

  app.get('/api/conversations', requireAuth, (req, res) => {
    const conversations = conversationStore.listHistories();
    return res.json({ conversations, total: conversations.length });
  });

  app.delete('/api/conversations/:key', requireAuth, (req, res) => {
    const key = decodeURIComponent(String(req.params.key || ''));
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
    const limit = Math.max(20, Math.min(2000, parseInt(String(req.query.limit || ''), 10) || 300));
    const query = String(req.query.q || '').trim().toLowerCase();
    let lines = collapseAdjacentDuplicateLines(readTailLines(SERVER_LOG_FILE, limit * 2, 1024 * 1024));
    if (query) {
      lines = lines.filter((line) => line.toLowerCase().includes(query));
    }
    lines = lines.slice(-limit);
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

  // ── QQ 沙盒（完全内存态，不依赖 NapCat） ────────────
  app.get('/api/sandbox', requireAuth, (_req, res) => {
    return res.json(qqSandbox.getState());
  });

  app.post('/api/sandbox/messages', requireAuth, async (req, res) => {
    try {
      const result = await qqSandbox.send(req.body || {});
      return res.json(result);
    } catch (error) {
      if (error instanceof SandboxRequestError) {
        return res.status(error.status).json({ detail: error.message });
      }
      console.error('[Sandbox] 发送消息失败:', error);
      return res.status(502).json({ detail: errorMessage(error) });
    }
  });

  app.post('/api/sandbox/reset', requireAuth, (_req, res) => {
    return res.json({ ok: true, state: qqSandbox.reset() });
  });

  // ── Agent Runtime ────────────────────────────────────
  app.get('/api/agent/agents', requireAuth, (_req, res) => {
    const agents = listAgents().map((agent) => ({
      name: agent.name,
      description: agent.description,
      mode: agent.mode,
      tools: agent.tools,
      permissions: agent.permissions,
      max_steps: agent.maxSteps,
    }));
    return res.json({ agents, total: agents.length });
  });

  app.get('/api/agent/runs', requireAuth, (req, res) => {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 50)));
    const sessionId = String(req.query.session_id || '').trim() || undefined;
    const runs = agentRunStore.listRuns(limit, sessionId);
    return res.json({ runs, total: runs.length });
  });

  app.get('/api/agent/runs/:id', requireAuth, (req, res) => {
    const run = agentRunStore.getRun(String(req.params.id || ''));
    if (!run) return res.status(404).json({ detail: '未找到 Agent 运行记录' });
    return res.json({ run, parts: agentRunStore.listParts(run.id) });
  });

  app.post('/api/agent/runs/:id/cancel', requireAuth, (req, res) => {
    const runId = String(req.params.id || '');
    if (!agentRunStore.getRun(runId)) return res.status(404).json({ detail: '未找到 Agent 运行记录' });
    const cancelled = cancelRun(runId, 'cancelled from admin API');
    if (!cancelled) return res.status(409).json({ detail: '该运行当前不在执行中' });
    agentRunStore.updateRun(runId, { status: 'cancelled', error: 'cancelled from admin API' });
    return res.json({ ok: true, run_id: runId });
  });

  app.get('/api/agent/approvals', requireAuth, (req, res) => {
    const rawStatus = String(req.query.status || '').trim();
    const status = ['pending', 'approved', 'denied', 'expired', 'consumed'].includes(rawStatus)
      ? rawStatus as 'pending' | 'approved' | 'denied' | 'expired' | 'consumed'
      : undefined;
    const approvals = agentRunStore.listApprovals(status);
    return res.json({ approvals, total: approvals.length });
  });

  app.post('/api/agent/approvals/:id/:action', requireAuth, async (req, res) => {
    const approval = agentRunStore.getApproval(String(req.params.id || ''));
    if (!approval) return res.status(404).json({ detail: '未找到审批请求' });
    const action = String(req.params.action || '');
    if (action !== 'approve' && action !== 'deny') return res.status(400).json({ detail: 'action 必须是 approve 或 deny' });
    if (qqSandbox.isSandboxGroup(approval.group_id)) {
      const result = await resolveApproval({
        approvalId: approval.id,
        approve: action === 'approve',
        event: qqSandbox.buildApprovalEvent(approval.requester_id),
        client: qqSandbox.client,
        cfg: qqSandbox.getAgentConfig(),
        trusted: true,
      });
      return res.status(result.ok ? 200 : 409).json(result);
    }
    if (!wsClient) return res.status(503).json({ detail: 'Bot 客户端不可用' });
    if (action === 'approve' && !wsClient.connected) return res.status(503).json({ detail: 'Bot 未连接 NapCat，暂时不能执行审批工具' });
    const login = wsClient.connected ? await wsClient.getLoginInfo() : null;
    const result = await resolveApproval({
      approvalId: approval.id,
      approve: action === 'approve',
      event: {
        post_type: 'message',
        message_type: approval.group_id ? 'group' : 'private',
        group_id: approval.group_id || null,
        user_id: approval.requester_id,
        self_id: login?.data?.user_id || null,
        raw_message: '确认执行',
      },
      client: wsClient,
      cfg: loadConfig(),
      trusted: true,
    });
    return res.status(result.ok ? 200 : 409).json(result);
  });

  // ── 前端静态文件 / SPA 路由 ─────────────────────────
  if (isViteDevEnabled()) {
    await mountViteDevServer(app, options.httpServer);
  } else {
    mountBuiltPanel(app);
  }

  return app;
}

export async function setupApp(client: OneBotWSClient, options: ConfigureOptions = {}) {
  const app = express();
  return configureApp(app, client, options);
}

export async function createServerApp(client: OneBotWSClient): Promise<{ app: Express; httpServer: HttpServer }> {
  const app = express();
  const httpServer = http.createServer(app);
  await configureApp(app, client, { httpServer });
  return { app, httpServer };
}
