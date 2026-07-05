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
export const CONFIG_FILE = workspacePath(process.env.QQ_BOT_CONFIG_FILE, path.join(WORKSPACE_DIR, 'config.json'));
export const MESSAGES_FILE = workspacePath(process.env.QQ_BOT_MESSAGES_FILE, path.join(WORKSPACE_DIR, 'messages.json'));
export const CONVERSATIONS_FILE = workspacePath(process.env.QQ_BOT_CONVERSATIONS_FILE, path.join(WORKSPACE_DIR, 'conversations.json'));
export const MEMORIES_FILE = workspacePath(process.env.QQ_BOT_MEMORIES_FILE, path.join(WORKSPACE_DIR, 'memories.json'));
export const SESSIONS_FILE = workspacePath(process.env.QQ_BOT_SESSIONS_FILE, path.join(DATA_DIR, 'sessions.json'));
export const IMAGE_CACHE_DIR = workspacePath(process.env.QQ_BOT_IMAGE_CACHE_DIR, path.join(DATA_DIR, 'images'));
export const SERVER_LOG_FILE = workspacePath(process.env.QQ_BOT_SERVER_LOG_FILE, path.join(LOG_DIR, 'server.log'));

// Lazy getters —— read env vars at call time so tests can set them after import
export function getMessagesFile(): string {
  return workspacePath(process.env.QQ_BOT_MESSAGES_FILE, path.join(WORKSPACE_DIR, 'messages.json'));
}
export function getConversationsFile(): string {
  return workspacePath(process.env.QQ_BOT_CONVERSATIONS_FILE, path.join(WORKSPACE_DIR, 'conversations.json'));
}
export function getMemoriesFile(): string {
  return workspacePath(process.env.QQ_BOT_MEMORIES_FILE, path.join(WORKSPACE_DIR, 'memories.json'));
}
