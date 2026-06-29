import path = require('path');
require('./env');

const SERVER_DIR = __dirname;
const WORKSPACE_DIR = path.resolve(SERVER_DIR, '..', '..');

function workspacePath(envValue: string | undefined, fallback: string): string {
  if (!envValue) return fallback;
  return path.resolve(WORKSPACE_DIR, envValue);
}

const DATA_DIR = workspacePath(process.env.QQ_BOT_DATA_DIR, path.join(WORKSPACE_DIR, 'data'));
const LOG_DIR = workspacePath(process.env.QQ_BOT_LOG_DIR, path.join(WORKSPACE_DIR, 'logs'));

module.exports = {
  SERVER_DIR,
  WORKSPACE_DIR,
  INDEX_HTML: path.join(WORKSPACE_DIR, 'index.html'),
  PANEL_DIST: path.join(WORKSPACE_DIR, 'dist'),
  CONFIG_FILE: workspacePath(process.env.QQ_BOT_CONFIG_FILE, path.join(WORKSPACE_DIR, 'config.json')),
  MESSAGES_FILE: workspacePath(process.env.QQ_BOT_MESSAGES_FILE, path.join(WORKSPACE_DIR, 'messages.json')),
  CONVERSATIONS_FILE: workspacePath(process.env.QQ_BOT_CONVERSATIONS_FILE, path.join(WORKSPACE_DIR, 'conversations.json')),
  MEMORIES_FILE: workspacePath(process.env.QQ_BOT_MEMORIES_FILE, path.join(WORKSPACE_DIR, 'memories.json')),
  SESSIONS_FILE: workspacePath(process.env.QQ_BOT_SESSIONS_FILE, path.join(DATA_DIR, 'sessions.json')),
  DATA_DIR,
  IMAGE_CACHE_DIR: workspacePath(process.env.QQ_BOT_IMAGE_CACHE_DIR, path.join(DATA_DIR, 'images')),
  LOG_DIR,
  SERVER_LOG_FILE: workspacePath(process.env.QQ_BOT_SERVER_LOG_FILE, path.join(LOG_DIR, 'server.log')),
};
