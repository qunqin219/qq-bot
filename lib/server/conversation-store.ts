// 对话上下文存储 —— 按私聊/群聊会话隔离，使用 JSON 文件持久化

import { getConversationsFile } from './paths.js';
import { readJsonFile, writeJsonFileAtomic } from './json-store.js';

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
  tool_executions?: Array<Record<string, unknown>>;
};

type ConversationEntry = {
  updated_at?: string | null;
  messages?: ConversationMessage[];
};

type ConversationStoreData = Record<string, ConversationEntry>;

type TurnMeta = {
  user_id?: number | string | null;
  user_name?: string | null;
  user_gemini_content?: unknown;
  model_gemini_content?: unknown;
  model_tool_executions?: unknown;
};

type GeminiContent = {
  role: ConversationRole;
  parts: Array<Record<string, unknown>>;
};

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
 * 安全读取全部历史；文件不存在或解析失败时返回空对象。
 */
function readStore(): ConversationStoreData {
  return readJsonFile<ConversationStoreData>(getConversationsFile(), {}, (data): data is ConversationStoreData => {
    return Boolean(data) && typeof data === 'object' && !Array.isArray(data);
  });
}

/**
 * 安全写入全部历史。
 */
function writeStore(data: ConversationStoreData): boolean {
  try {
    writeJsonFileAtomic(getConversationsFile(), data);
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[ConversationStore] 写入对话历史失败:', message);
    return false;
  }
}

/**
 * 获取指定会话最近 limit 条消息，返回 Gemini 可用的 role/text 列表。
 */
function getHistory(key: string, limit: unknown = 20) {
  if (!key) return [];
  const data = readStore();
  const messages = Array.isArray(data[key]?.messages) ? data[key].messages : [];
  const safeLimit = Math.max(0, Number(limit) || 20);
  return messages
    .slice(-safeLimit)
    .filter((m) => m && (m.role === 'user' || m.role === 'model') && typeof m.text === 'string')
    .map((m) => {
      const toolExecutions = normalizeToolExecutions(m.tool_executions);
      return {
        role: m.role,
        text: m.text,
        time: m.time,
        ...(isGeminiContent(m.gemini_content) ? { gemini_content: m.gemini_content } : {}),
        ...(toolExecutions.length ? { tool_executions: toolExecutions } : {}),
      };
    });
}

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

function normalizeToolExecutions(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .slice(-20)
    .map((item) => cloneJson(item as Record<string, unknown>))
    .filter((item): item is Record<string, unknown> => Boolean(item));
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

function getRecentTurns(key: string, limit: unknown = 8) {
  if (!key) return [];
  const data = readStore();
  const messages = Array.isArray(data[key]?.messages) ? data[key].messages : [];
  const turns = [];
  let pendingUser: ConversationMessage | null = null;
  for (const message of messages) {
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
        user_name: pendingUser.user_name || pendingUser.speaker_name || user.speaker_name || null,
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
  const data = readStore();
  const now = new Date().toISOString();
  const entry = data[key] || { updated_at: now, messages: [] };
  const messages = Array.isArray(entry.messages) ? entry.messages : [];
  const userEntry: ConversationMessage = { role: 'user', text: String(userText), time: now };
  const modelEntry: ConversationMessage = { role: 'model', text: String(assistantText), time: now };
  if (meta.user_id) userEntry.user_id = meta.user_id;
  if (meta.user_name) userEntry.user_name = meta.user_name;
  const userGeminiContent = normalizeGeminiContent(meta.user_gemini_content, 'user');
  const modelGeminiContent = normalizeGeminiContent(meta.model_gemini_content, 'model');
  const modelToolExecutions = normalizeToolExecutions(meta.model_tool_executions);
  if (userGeminiContent) userEntry.gemini_content = userGeminiContent;
  if (modelGeminiContent) modelEntry.gemini_content = modelGeminiContent;
  if (modelToolExecutions.length) modelEntry.tool_executions = modelToolExecutions;
  messages.push(userEntry);
  messages.push(modelEntry);

  const turns = Math.max(1, Number(maxTurns) || 20);
  entry.messages = messages.slice(-(turns * 2));
  entry.updated_at = now;
  data[key] = entry;
  return writeStore(data);
}

/**
 * 清空指定会话历史。
 */
function clearHistory(key: string): boolean {
  if (!key) return false;
  const data = readStore();
  const existed = Object.prototype.hasOwnProperty.call(data, key);
  delete data[key];
  writeStore(data);
  return existed;
}

/**
 * 清空全部会话历史。
 */
function clearAllHistories(): boolean {
  return writeStore({});
}

/**
 * 列出全部会话摘要，turns 表示对话轮数，updated_at 为最近更新时间。
 */
function listHistories() {
  const data = readStore();
  return Object.entries(data)
    .map(([key, value]) => {
      const messageCount = Array.isArray(value?.messages) ? value.messages.length : 0;
      return {
        key,
        turns: Math.ceil(messageCount / 2),
        updated_at: value?.updated_at || null,
      };
    })
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
