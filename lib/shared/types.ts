// 前后端共享的 API 类型定义
// 后端 api.ts 的响应和前端 client.ts 的返回类型都应遵守这些接口

// ── 认证 ──
export interface MeResponse {
  authenticated: boolean;
}

export interface LoginResponse {
  authenticated: boolean;
  username?: string;
}

// ── 状态 ──
export interface BotLoginInfo {
  user_id?: number | string;
  nickname?: string;
}

export interface GroupInfo {
  group_id: number | string;
  group_name?: string;
  member_count?: number;
  [key: string]: unknown;
}

export interface StatusResponse {
  connected: boolean;
  login?: BotLoginInfo;
  groups?: GroupInfo[];
}

// ── 配置（脱敏后的前端配置） ──
export interface ConfigResponse {
  admins: Array<number | string>;
  command_prefix: string;
  napcat_ws: string;
  active_groups: Array<number | string>;
  group_filter_enabled: boolean;
  panel_username: string;
  // AI 配置
  ai_enabled: boolean;
  ai_provider?: string;
  ai_base_url: string;
  ai_api_key?: string;
  ai_api_key_configured?: boolean;
  ai_api_key_last4?: string;
  ai_api_key_source?: 'config' | 'environment' | '';
  ai_model: string;
  ai_system_prompt: string;
  ai_context_enabled: boolean;
  ai_context_turns: number;
  ai_thinking_enabled: boolean;
  ai_thinking_level: string;
  ai_google_search_enabled: boolean;
  ai_url_context_enabled: boolean;
  ai_web_search_enabled: boolean;
  ai_web_search_context_size: string;
  ai_web_fetch_enabled: boolean;
  ai_allow_group_mention_from_non_admin: boolean;
  ai_group_context_enabled: boolean;
  ai_group_context_messages: number;
  ai_group_context_include_quote: boolean;
  ai_group_context_exclude_bot: boolean;
  ai_filter_stickers: boolean;
  ai_group_reply_quote_enabled: boolean;
  ai_group_reply_quote_prefer_quoted: boolean;
  ai_memory_enabled: boolean;
  agent_context_token_budget: number;
  agent_output_token_reserve: number;
  agent_recent_turns: number;
  agent_session_max_turns: number;
  agent_max_tool_calls: number;
  agent_run_timeout_ms: number;
  agent_tool_timeout_ms: number;
  agent_tool_result_max_chars: number;
  [key: string]: unknown;
}

// ── 消息 ──
export interface StoredMessage {
  message_id: number | string;
  user_id: number | string;
  user_name?: string;
  group_id?: number | string | null;
  group_name?: string;
  raw_message?: string;
  message_type?: string;
  time?: string | number;
  sender?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MessagesResponse {
  messages: StoredMessage[];
  total: number;
}

export interface ChatSummary {
  id: string;
  type: 'group' | 'private';
  name?: string;
  last_message_time?: string;
  [key: string]: unknown;
}

export interface ChatsResponse {
  chats: ChatSummary[];
  total: number;
}

// ── AI 对话上下文 ──
export interface ConversationSummary {
  key: string;
  turns: number;
  updated_at: string;
  [key: string]: unknown;
}

export interface ConversationsResponse {
  conversations: ConversationSummary[];
}

// ── 个性化记忆 ──
export interface MemoryRecord {
  id: number;
  conversation_key: string;
  content: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface MemoriesResponse {
  memories: MemoryRecord[];
}

// ── 日志 ──
export interface LogsResponse {
  lines: string[];
  total?: number;
  [key: string]: unknown;
}

// ── QQ 沙盒 ──
export type SandboxMode = 'private' | 'group';

export interface SandboxMember {
  user_id: number;
  nickname: string;
  card: string;
  role: 'owner' | 'admin' | 'member';
  muted_until: string | null;
  kicked: boolean;
}

export interface SandboxMessage {
  id: string;
  message_id: number;
  mode: SandboxMode;
  group_id: number | null;
  user_id: number;
  sender_name: string;
  sender_role: string;
  text: string;
  reply_to: number | null;
  from_bot: boolean;
  kind?: 'message' | 'progress';
  created_at: string;
  run_id?: string;
  agent?: string;
}

export interface SandboxStateResponse {
  isolated: true;
  napcat_connected: false;
  ai_configured: boolean;
  provider: string;
  model: string;
  bot: { user_id: number; nickname: string; role: 'admin' };
  private_peer: SandboxMember;
  group: {
    group_id: number;
    group_name: string;
    whole_ban: boolean;
    members: SandboxMember[];
  };
  messages: Record<SandboxMode, SandboxMessage[]>;
}

export interface SandboxSendInput {
  mode: SandboxMode;
  text: string;
  sender_id?: number;
  reply_to?: number | null;
  trigger_ai?: boolean;
}

export interface SandboxSendResponse {
  ok: true;
  state: SandboxStateResponse;
  incoming: SandboxMessage;
  reply: SandboxMessage | null;
  run_id: string | null;
}

// ── 通用 API 响应 ──
export interface ApiResult {
  ok?: boolean;
  message?: string;
  [key: string]: unknown;
}
