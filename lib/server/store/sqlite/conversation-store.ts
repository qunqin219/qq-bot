// 对话上下文存储 —— SQLite 实现，行为与 lib/server/conversation-store.ts (JSON) 完全一致

import type { Database } from 'better-sqlite3';

import { getDb } from './db.js';

type ConversationEvent = {
  group_id?: number | string | null;
  user_id?: number | string | null;
} | null | undefined;

type ConversationRole = 'user' | 'model';

type ConversationMessage = {
  role?: ConversationRole | string;
  text?: string;
  time?: string;
  user_id?: number | string | null;
  user_name?: string | null;
  speaker_name?: string | null;
  gemini_content?: GeminiContent | null;
};

type TurnMeta = {
  user_id?: number | string | null;
  user_name?: string | null;
  user_gemini_content?: unknown;
  model_gemini_content?: unknown;
};

type GeminiContent = {
  role: ConversationRole;
  parts: Array<Record<string, unknown>>;
};

// ── 辅助函数（与 JSON 实现保持一致） ──

function cloneJson<T>(value: T): T | null {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return null;
  }
}

function isGeminiContent(value: unknown): value is GeminiContent {
  const content = value as GeminiContent;
  return Boolean(
    content &&
      (content.role === 'user' || content.role === 'model') &&
      Array.isArray(content.parts) &&
      content.parts.length > 0 &&
      content.parts.every((part) => part && typeof part === 'object' && !Array.isArray(part))
  );
}

function normalizeGeminiContent(value: unknown, role: ConversationRole): GeminiContent | null {
  if (!isGeminiContent(value) || value.role !== role) return null;
  const cloned = cloneJson(value);
  return isGeminiContent(cloned) ? cloned : null;
}

function stripLegacyUserPrefix(text: unknown): { speaker_name: string | null; text: string } {
  const value = String(text || '');
  const match = value.match(/^(.{1,80}?) 问：([\s\S]*)$/);
  return match ? { speaker_name: match[1], text: match[2] } : { speaker_name: null, text: value };
}

function stripLegacyModelPrefix(text: unknown): { target_name: string | null; text: string } {
  const value = String(text || '');
  const match = value.match(/^Bot 回复 (.{1,80}?)：([\s\S]*)$/);
  return match ? { target_name: match[1], text: match[2] } : { target_name: null, text: value };
}

// ── prepared statement 缓存 ──

const _stmtCache: Record<string, any> = {};

function stmt(sql: string): any {
  let s = _stmtCache[sql];
  if (!s) {
    s = getDb().prepare(sql);
    _stmtCache[sql] = s;
  }
  return s;
}

/**
 * 根据 OneBot 事件生成会话 key。
 * 私聊：private:${user_id}；群聊：group:${group_id}
 */
function getConversationKey(event: ConversationEvent): string {
  if (!event) return 'private:unknown';
  if (event.group_id) return `group:${event.group_id}`;
  return `private:${event.user_id || 'unknown'}`;
}

/**
 * 获取指定会话最近 limit 条消息，返回 Gemini 可用的 role/text 列表。
 * 行为与 JSON 实现一致：先取最后 limit 条，再过滤 role/text，最后按时间从旧到新。
 */
function getHistory(key: string, limit: unknown = 20): ConversationMessage[] {
  if (!key) return [];
  const rows = stmt(
    'SELECT role, text, time, user_id, user_name, gemini_content FROM conversation_turns WHERE conversation_key = ? ORDER BY id ASC'
  ).all(key) as Array<{
    role: string;
    text: string | null;
    time: string | null;
    user_id: string | null;
    user_name: string | null;
    gemini_content: string | null;
  }>;

  const messages: ConversationMessage[] = rows.map((row) => {
    let parsed: unknown = null;
    if (row.gemini_content) {
      try {
        parsed = JSON.parse(row.gemini_content);
      } catch {
        parsed = null;
      }
    }
    return {
      role: row.role,
      text: row.text ?? undefined,
      time: row.time ?? undefined,
      user_id: row.user_id,
      user_name: row.user_name,
      gemini_content: parsed as GeminiContent | null,
    };
  });

  const safeLimit = Math.max(0, Number(limit) || 20);
  return messages
    .slice(-safeLimit)
    .filter((m) => m && (m.role === 'user' || m.role === 'model') && typeof m.text === 'string')
    .map((m) => ({
      role: m.role,
      text: m.text,
      time: m.time,
      ...(isGeminiContent(m.gemini_content) ? { gemini_content: m.gemini_content } : {}),
    })) as ConversationMessage[];
}

/**
 * 获取最近 N 轮对话（user + model 配对）。
 */
function getRecentTurns(key: string, limit: unknown = 8): Array<Record<string, unknown>> {
  if (!key) return [];
  const rows = stmt(
    'SELECT role, text, time, user_id, user_name FROM conversation_turns WHERE conversation_key = ? ORDER BY id ASC'
  ).all(key) as Array<{
    role: string;
    text: string | null;
    time: string | null;
    user_id: string | null;
    user_name: string | null;
  }>;

  const turns: Array<Record<string, unknown>> = [];
  let pendingUser: (typeof rows)[number] | null = null;
  for (const message of rows) {
    if (!message || typeof message.text !== 'string') continue;
    if (message.role === 'user') {
      pendingUser = message;
      continue;
    }
    if (message.role === 'model' && pendingUser) {
      const user = stripLegacyUserPrefix(pendingUser.text);
      const assistant = stripLegacyModelPrefix(message.text);
      turns.push({
        time: message.time || pendingUser.time || null,
        user_id: pendingUser.user_id || null,
        user_name: pendingUser.user_name || user.speaker_name || null,
        user_text: user.text,
        assistant_text: assistant.text,
      });
      pendingUser = null;
    }
  }
  const safeLimit = Math.max(1, Math.min(20, Number(limit) || 8));
  return turns.slice(-safeLimit);
}

/**
 * 追加一轮用户/模型对话，并限制每个会话最多 maxTurns * 2 条消息。
 */
function appendTurn(
  key: string,
  userText: unknown,
  assistantText: unknown,
  maxTurns: unknown = 20,
  meta: TurnMeta = {}
): boolean {
  if (!key || !userText || !assistantText) return false;
  const now = new Date().toISOString();
  const userGeminiContent = normalizeGeminiContent(meta.user_gemini_content, 'user');
  const modelGeminiContent = normalizeGeminiContent(meta.model_gemini_content, 'model');
  const turns = Math.max(1, Number(maxTurns) || 20);
  const keep = turns * 2;

  const insertStmt = stmt(
    'INSERT INTO conversation_turns (conversation_key, role, text, time, user_id, user_name, gemini_content) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const trimStmt = stmt(
    'DELETE FROM conversation_turns WHERE conversation_key = ? AND id NOT IN (SELECT id FROM conversation_turns WHERE conversation_key = ? ORDER BY id DESC LIMIT ?)'
  );

  const db = getDb();
  const tx = db.transaction(() => {
    insertStmt.run(
      key,
      'user',
      String(userText),
      now,
      meta.user_id ? String(meta.user_id) : null,
      meta.user_name ? String(meta.user_name) : null,
      userGeminiContent ? JSON.stringify(userGeminiContent) : null
    );
    insertStmt.run(key, 'model', String(assistantText), now, null, null, modelGeminiContent ? JSON.stringify(modelGeminiContent) : null);
    trimStmt.run(key, key, keep);
  });
  try {
    tx();
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[ConversationStore:sqlite] 写入对话历史失败:', message);
    return false;
  }
}

/**
 * 清空指定会话历史。
 */
function clearHistory(key: string): boolean {
  if (!key) return false;
  const result = stmt('DELETE FROM conversation_turns WHERE conversation_key = ?').run(key);
  return result.changes > 0;
}

/**
 * 清空全部会话历史。
 */
function clearAllHistories(): boolean {
  try {
    stmt('DELETE FROM conversation_turns').run();
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[ConversationStore:sqlite] 清空对话历史失败:', message);
    return false;
  }
}

/**
 * 列出全部会话摘要，turns 表示对话轮数，updated_at 为最近更新时间。
 */
function listHistories(): Array<Record<string, unknown>> {
  const rows = stmt(
    'SELECT conversation_key AS key, COUNT(*) AS cnt, MAX(time) AS updated_at FROM conversation_turns GROUP BY conversation_key'
  ).all() as Array<{ key: string; cnt: number; updated_at: string | null }>;
  return rows
    .map((row) => ({
      key: row.key,
      turns: Math.ceil(row.cnt / 2),
      updated_at: row.updated_at || null,
    }))
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}

export {
  getConversationKey,
  getHistory,
  getRecentTurns,
  appendTurn,
  clearHistory,
  clearAllHistories,
  listHistories,
};
