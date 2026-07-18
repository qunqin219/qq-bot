// 存储层接口定义 —— 所有后端（JSON/SQLite）必须实现这些接口

// ── 消息存储 ──
export interface OneBotMessageEvent {
  message_id?: number | string;
  user_id?: number | string;
  sender?: { nickname?: string; card?: string };
  message_type?: string;
  group_id?: number | string;
  raw_message?: string;
  message?: unknown;
}

export interface StoredMessage {
  message_id?: number | string;
  user_id?: number | string;
  nickname: string;
  message_type?: string;
  group_id?: number | string;
  group_name: string;
  raw_message: string;
  time: string;
}

export interface MessageSearchOptions {
  query?: unknown;
  limit?: unknown;
  scanLimit?: unknown;
  groupId?: unknown;
  privateUserId?: unknown;
  userId?: unknown;
  messageType?: unknown;
  fromTime?: string | number | Date;
  toTime?: string | number | Date;
  regex?: boolean;
}

export interface ChatSummary {
  id: number | string;
  type: 'group' | 'private';
  name: string;
}

export interface IMessageStore {
  addMessage(event: OneBotMessageEvent): void;
  getMessages(
    limit?: unknown,
    userId?: number | string | null,
    groupId?: number | string | null
  ): StoredMessage[];
  searchMessages(options?: MessageSearchOptions): Record<string, unknown>;
  getChats(): ChatSummary[];
  MAX_MESSAGES: number;
}

// ── 对话上下文存储 ──
export interface ConversationEvent {
  group_id?: number | string | null;
  user_id?: number | string | null;
}

export interface ConversationMessage {
  role?: string;
  text?: string;
  time?: string;
  user_id?: number | string | null;
  user_name?: string | null;
  speaker_name?: string | null;
  gemini_content?: unknown;
  tool_executions?: Array<Record<string, unknown>>;
}

export interface TurnMeta {
  user_id?: number | string | null;
  user_name?: string | null;
  user_gemini_content?: unknown;
  model_gemini_content?: unknown;
  model_tool_executions?: unknown;
}

export interface IConversationStore {
  getConversationKey(event: ConversationEvent | null | undefined): string;
  getHistory(key: string, limit?: unknown): ConversationMessage[];
  getRecentTurns(key: string, limit?: unknown): Array<Record<string, unknown>>;
  appendTurn(
    key: string,
    userText: unknown,
    assistantText: unknown,
    maxTurns?: unknown,
    meta?: TurnMeta
  ): boolean;
  clearHistory(key: string): boolean;
  clearAllHistories(): boolean;
  listHistories(): Array<Record<string, unknown>>;
}

// ── 记忆存储 ──
export interface MemoryRecord {
  id: number;
  conversationKey: string;
  content: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface MemorySummary {
  key: string;
  count: number;
  updated_at: string | null;
}

export interface IMemoryStore {
  getAll(): MemoryRecord[];
  getForConversation(conversationKey: unknown): MemoryRecord[];
  add(conversationKey: unknown, content: unknown): MemoryRecord | null;
  update(conversationKey: unknown, id: unknown, content: unknown): MemoryRecord | null;
  remove(conversationKey: unknown, id: unknown): boolean;
  deleteForConversation(conversationKey: unknown): boolean;
  clearAll(): boolean;
  listSummaries(): MemorySummary[];
}
