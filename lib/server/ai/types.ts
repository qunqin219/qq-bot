// AI 模块共享的类型定义和常量

import type { ImageCacheEntry, ImageRecord } from '../image-cache.js';

// ── 常量 ──
export const MAX_IMAGES_PER_MESSAGE = 3;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MAX_TOOL_ROUNDS = 4;
export const DEFAULT_MAX_TOOL_CALLS = 8;
export const DEFAULT_MAX_FUNCTION_CALLS_PER_ROUND = 3;
export const DEFAULT_MAX_HTTP_RETRIES = 3;
export const DEFAULT_HTTP_RETRY_BASE_DELAY_MS = 1000;
export const MAX_HTTP_RETRY_DELAY_MS = 8000;
export const INTERNAL_INLINE_PARTS_FIELD = '__ai_inline_parts';

export const NO_THOUGHT_LEAK_SYSTEM_INSTRUCTION = [
  '最终回复只能包含要发给 QQ 用户的自然语言正文。',
  '不要输出思维链、推理过程、内部草稿、隐藏分析、工具过程或调试标签。',
  '不要输出 _thought、thought、thinking、analysis、reasoning、scratchpad、<think>、<analysis>、```thought 这类字段或标记。',
].join('\n');

export const NO_UNREQUESTED_LINKS_SYSTEM_INSTRUCTION = [
  '默认不要在回复中输出 URL、网址、Markdown 链接、来源列表或参考资料。',
  '只有当前用户明确要求提供链接、网址、来源、出处或参考资料时，才可以输出这些内容。',
  '用户没有主动要求时，即使使用了搜索或网页工具，也只回答正文结论。',
].join('\n');

export const THOUGHT_LEAK_REPAIR_PROMPT = [
  '上一条候选回复包含内部草稿、思维链，或者是不完整/异常的残留内容（比如工具调用碎片），已被系统拦截。',
  '请重新回答当前用户，只输出最终自然回复正文，用完整的自然语言句子回答，不要输出任何 JSON、代码片段或残缺内容。',
  '不要输出 _thought、thinking、analysis、reasoning、思考过程、草稿或任何内部标签。',
].join('\n');

export const TOOL_FINALIZATION_PROMPT = [
  '工具调用已达到宿主允许的上限。不要再调用任何工具。',
  '请仅根据当前对话和已经获得的工具结果，直接给出对用户有用的最终回答。',
  '不要输出工具名称、调用过程、调试信息，也不要逐条复述“读取成功”或请求状态。',
  '如果现有证据不足或部分请求失败，请简洁说明结论边界，不要虚构。',
].join('\n');

// ── 通用类型（模型无关）──
export type AiConfig = Record<string, any>;

export type FunctionCall = {
  callId?: string;
  name: string;
  args?: Record<string, unknown>;
};

export type ToolResult = {
  callId?: string;
  name: string;
  response: any;
};

export type BuiltinToolAudit = {
  callId?: string;
  name: string;
  status: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
};

export type ToolProgressUpdate = {
  round: number;
  text: string;
  source: 'model' | 'builtin_tool';
  toolNames: string[];
};

export type SanitizedReply = {
  text: string;
  leaked: boolean;
  blocked: boolean;
  reason: string;
};

export type ChatOptions = {
  extraSystemInstruction?: string;
  functionDeclarations?: unknown[];
  executeFunctionCall?: (
    name: string,
    args: Record<string, unknown>,
    context: { round: number; index: number; executedToolCalls: number }
  ) => Promise<any> | any;
  maxToolRounds?: number;
  maxToolCalls?: number;
  maxCallsPerRound?: number;
  maxHttpRetries?: number;
  httpRetryBaseDelayMs?: number;
  autoAttachImages?: boolean;
  extraParts?: Record<string, unknown>[];
  onFinalTurn?: (_turn: { userContent: any; modelContent: any; reply: string }) => void;
  onBuiltinToolCalls?: (
    calls: BuiltinToolAudit[],
    context: { round: number }
  ) => void;
  onProgress?: (update: ToolProgressUpdate) => Promise<void> | void;
  signal?: AbortSignal;
};

// ── Gemini 专属类型 ──
export type Role = 'user' | 'model';

export type TextPart = { text: string };
export type InlineDataPart = { inline_data: { mime_type: string; data: string } };
export type FunctionResponsePart = { functionResponse: { name: string; response: unknown } };
export type ContentPart = TextPart | InlineDataPart | FunctionResponsePart | Record<string, unknown>;

export type GeminiContent = {
  role: Role;
  parts: ContentPart[];
};

export type GeminiRequestBody = {
  contents: GeminiContent[];
  systemInstruction?: { parts: TextPart[] };
  generationConfig?: {
    thinkingConfig?: {
      thinkingBudget?: number;
      includeThoughts?: boolean;
      thinkingLevel?: string;
    };
  };
  tools?: GeminiTool[];
};

export type GeminiTool =
  | { functionDeclarations: unknown[] }
  | { googleSearch: Record<string, never> }
  | { urlContext: Record<string, never> };

export type GeminiFunctionCall = {
  name: string;
  args?: Record<string, unknown>;
};

export type GeminiResponse = {
  candidates?: Array<{
    content?: GeminiContent;
    groundingMetadata?: Record<string, any>;
    urlContextMetadata?: Record<string, any>;
  }>;
  urlContextMetadata?: Record<string, any>;
};

export type HistoryItem = {
  role: Role;
  text: string;
  gemini_content?: GeminiContent;
};

// Re-export image-cache types for convenience
export type { ImageCacheEntry, ImageRecord };
