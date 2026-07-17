import path from 'path';
import { fileURLToPath } from 'url';
import './env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SERVER_DIR = __dirname;
export const WORKSPACE_DIR = path.resolve(SERVER_DIR, '..', '..');

function workspacePath(envValue: string | undefined, fallback: string): string {
  if (!envValue) return fallback;
  return path.resolve(WORKSPACE_DIR, envValue);
}

export const DATA_DIR = workspacePath(process.env.QQ_BOT_DATA_DIR, path.join(WORKSPACE_DIR, 'data'));
export const LOG_DIR = workspacePath(process.env.QQ_BOT_LOG_DIR, path.join(WORKSPACE_DIR, 'logs'));

export const INDEX_HTML = path.join(WORKSPACE_DIR, 'index.html');
export const PANEL_DIST = path.join(WORKSPACE_DIR, 'dist');
export const MESSAGES_FILE = workspacePath(process.env.QQ_BOT_MESSAGES_FILE, path.join(WORKSPACE_DIR, 'messages.json'));
export const CONVERSATIONS_FILE = workspacePath(process.env.QQ_BOT_CONVERSATIONS_FILE, path.join(WORKSPACE_DIR, 'conversations.json'));
export const MEMORIES_FILE = workspacePath(process.env.QQ_BOT_MEMORIES_FILE, path.join(WORKSPACE_DIR, 'memories.json'));
export const SESSIONS_FILE = workspacePath(process.env.QQ_BOT_SESSIONS_FILE, path.join(DATA_DIR, 'sessions.json'));
export const AGENT_RUNTIME_FILE = workspacePath(
  process.env.QQ_BOT_AGENT_RUNTIME_FILE,
  path.join(DATA_DIR, 'agent-runtime.json')
);
export const IMAGE_CACHE_DIR = workspacePath(process.env.QQ_BOT_IMAGE_CACHE_DIR, path.join(DATA_DIR, 'images'));
export const SERVER_LOG_FILE = workspacePath(process.env.QQ_BOT_SERVER_LOG_FILE, path.join(LOG_DIR, 'server.log'));

// Lazy getters —— read env vars at call time so tests can set them after import
export function getConfigFile(): string {
  return workspacePath(process.env.QQ_BOT_CONFIG_FILE, path.join(WORKSPACE_DIR, 'config.json'));
}
export function getMessagesFile(): string {
  return workspacePath(process.env.QQ_BOT_MESSAGES_FILE, path.join(WORKSPACE_DIR, 'messages.json'));
}
export function getConversationsFile(): string {
  return workspacePath(process.env.QQ_BOT_CONVERSATIONS_FILE, path.join(WORKSPACE_DIR, 'conversations.json'));
}
export function getMemoriesFile(): string {
  return workspacePath(process.env.QQ_BOT_MEMORIES_FILE, path.join(WORKSPACE_DIR, 'memories.json'));
}
export function getAgentRuntimeFile(): string {
  if (process.env.QQ_BOT_AGENT_RUNTIME_FILE) {
    return workspacePath(process.env.QQ_BOT_AGENT_RUNTIME_FILE, path.join(DATA_DIR, 'agent-runtime.json'));
  }
  // JSON 后端测试/迁移通常只重定向 conversations 文件；让 Agent 数据跟随它进入同一临时目录。
  if (process.env.QQ_BOT_CONVERSATIONS_FILE) {
    return path.join(path.dirname(workspacePath(process.env.QQ_BOT_CONVERSATIONS_FILE, '')), 'agent-runtime.json');
  }
  return path.join(DATA_DIR, 'agent-runtime.json');
}
