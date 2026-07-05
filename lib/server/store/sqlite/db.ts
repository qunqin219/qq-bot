// SQLite 数据库初始化 —— WAL 模式 + 自动建表

import type { Database } from 'better-sqlite3';
import BetterSqlite3 from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

import { DATA_DIR } from '../../paths.js';

const DEFAULT_DB_PATH = path.join(DATA_DIR, 'bot.db');

function resolveDbPath(): string {
  const envPath = process.env.QQ_BOT_DB_PATH;
  if (envPath) return envPath;
  return DEFAULT_DB_PATH;
}

let _db: Database | null = null;

function getDb(): Database {
  if (_db) return _db;

  const dbPath = resolveDbPath();

  // 确保父目录存在（:memory: 不需要）
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db: Database = new BetterSqlite3(dbPath);

  // WAL 模式：读写并发安全，性能更好
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');

  runMigrations(db);

  _db = db;
  return _db;
}

function runMigrations(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT,
      user_id TEXT,
      nickname TEXT DEFAULT '',
      message_type TEXT,
      group_id TEXT,
      group_name TEXT DEFAULT '',
      raw_message TEXT DEFAULT '',
      time TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_messages_group ON messages(group_id);
    CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
    CREATE INDEX IF NOT EXISTS idx_messages_time ON messages(time);

    CREATE TABLE IF NOT EXISTS conversation_turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_key TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT,
      time TEXT,
      user_id TEXT,
      user_name TEXT,
      gemini_content TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_conv_key ON conversation_turns(conversation_key);

    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_key TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_memories_key ON memories(conversation_key);
  `);
}

function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// 测试用：重置数据库连接（配合 :memory: 使用）
function resetDb(): void {
  closeDb();
}

export { getDb, closeDb, resetDb, resolveDbPath, DEFAULT_DB_PATH };
