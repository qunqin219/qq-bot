export type Role = 'owner' | 'admin' | 'member' | 'unknown' | 'none' | string;

export type BotConfig = Record<string, any> & {
  admins?: Array<number | string>;
  active_groups?: Array<number | string>;
  command_prefix?: string;
};

export type OneBotSender = {
  user_id?: number | string;
  nickname?: string;
  card?: string;
  role?: Role;
  title?: string;
};

export type OneBotEvent = {
  post_type?: string;
  message_type?: string;
  group_id?: number | string | null;
  user_id?: number | string | null;
  self_id?: number | string | null;
  message_id?: number | string | null;
  raw_message?: string;
  message?: unknown;
  sender?: OneBotSender;
};

export type OneBotResult<T = any> = {
  status?: string;
  data?: T;
  wording?: string;
  msg?: string;
};

export type OneBotClient = Record<string, any> & {
  connected?: boolean;
  sendGroupMsg?: (groupId: number | string, message: string) => Promise<OneBotResult> | OneBotResult;
  sendPrivateMsg?: (userId: number | string, message: string) => Promise<OneBotResult> | OneBotResult;
  getLoginInfo?: () => Promise<OneBotResult> | OneBotResult;
  getGroupMemberInfo?: (
    groupId: number | string,
    userId: number | string,
    noCache?: boolean
  ) => Promise<OneBotResult<Record<string, any>>> | OneBotResult<Record<string, any>>;
  getGroupMemberList?: (groupId: number | string) => Promise<OneBotResult<Array<Record<string, any>>>> | OneBotResult<Array<Record<string, any>>>;
  getMsg?: (messageId: number | string) => Promise<OneBotResult<Record<string, any>>> | OneBotResult<Record<string, any>>;
  setGroupWholeBan?: (groupId: number | string, enable: boolean) => Promise<OneBotResult> | OneBotResult;
  setGroupBan?: (groupId: number | string, userId: number | string, duration: number) => Promise<OneBotResult> | OneBotResult;
  setGroupKick?: (groupId: number | string, userId: number | string, rejectAddRequest: boolean) => Promise<OneBotResult> | OneBotResult;
};

export type ToolArgs = Record<string, any>;

export type GroupManagementContext = {
  event: OneBotEvent;
  client: OneBotClient;
  cfg: BotConfig;
  botRole: Role;
  requesterIsAdmin: boolean;
};

export type ManagementPromptContext = {
  botRole: Role;
  toolsEnabled: boolean;
  memberListEnabled: boolean;
  requesterIsAdmin: boolean;
};

export type ToolDeclarationOptions = {
  memoryEnabled?: boolean;
  imageReadEnabled?: boolean;
  memberListEnabled?: boolean;
  managementEnabled?: boolean;
};

export type AiRuntimePreviewInput = {
  event: OneBotEvent;
  client: OneBotClient;
  cfg?: BotConfig;
};

export const INTERNAL_INLINE_PARTS_FIELD = '__ai_inline_parts';
export const IMAGE_TOOL_SEARCH_LIMIT = 120;
export const MAX_GROUP_CONTEXT_INLINE_IMAGES = 8;
