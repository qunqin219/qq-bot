// LLMProvider 接口 —— 抽象不同 AI 模型提供商的差异
//
// chat() 工具循环通过此接口与具体模型交互。
// Gemini 与 OpenAI Responses API 都通过同一套 Agent 工具循环运行。

import type {
  AiConfig,
  BuiltinToolAudit,
  ChatOptions,
  FunctionCall,
  SanitizedReply,
  ToolResult,
} from './types.js';

export type ProviderStreamEvent = {
  type: 'builtin_tool.started';
  tool: string;
};

export type ProviderRequestOptions = {
  signal?: AbortSignal;
  onStreamEvent?: (event: ProviderStreamEvent) => Promise<void> | void;
};

export type PrepareToolResultsOptions = {
  signal?: AbortSignal;
  userMessage?: unknown;
};

export interface LLMProvider {
  readonly name: string;

  // 当前 Provider 是否已经具备可用凭据。
  isConfigured(cfg: AiConfig): boolean;

  // 构建请求体
  buildRequestBody(
    userMessage: unknown,
    history: unknown,
    cfg: AiConfig,
    options: ChatOptions
  ): Promise<any>;

  // 发送 HTTP 请求，返回原始 Response
  sendRequest(body: any, cfg: AiConfig, options?: ProviderRequestOptions): Promise<Response>;

  // 从响应中提取函数调用
  extractFunctionCalls(data: any): FunctionCall[];

  // 从响应中提取可见文本
  extractOutputText(data: any): string;

  // 提取由模型渠道在服务端执行的内置工具调用，例如 OpenAI web_search。
  extractBuiltinToolCalls(data: any): BuiltinToolAudit[];

  // 从响应中获取模型内容对象（用于追加到请求体和历史记录）
  getModelContent(data: any): any | undefined;

  // 构建函数响应 parts
  buildFunctionResponseParts(results: ToolResult[]): any[];

  // Provider 可在续接主工具循环前转换工具结果。例如把中转无法直接处理的图片工具结果
  // 先通过一次普通多模态请求识别成文本。
  prepareToolResults?(
    results: ToolResult[],
    cfg: AiConfig,
    options?: PrepareToolResultsOptions
  ): Promise<ToolResult[]>;

  // 构建用于历史记录的模型内容
  buildModelContentForHistory(
    content: any | undefined,
    reply: string,
    sanitized: SanitizedReply
  ): any;

  // 从内容中移除 inline_data（用于清理历史记录中的图片数据）
  removeInlineDataFromContent(content: any): any;

  // 从请求体中获取最后一个用户消息内容（用于 onFinalTurn 回调）
  getLastUserContent(body: any): any;

  // 向请求体追加内容条目
  appendContents(body: any, contents: any[]): void;

  // 追加一次普通用户输入（例如泄漏修复提示）。
  appendUserMessage(body: any, text: string): void;

  // 关闭请求体中的所有工具，要求下一轮只能生成最终文本。
  disableTools(body: any): void;

  // 追加模型工具调用原始条目和对应的工具结果。
  appendToolResults(body: any, data: any, results: ToolResult[]): boolean;

  // 返回当前请求体中的会话条目数量，用于模型无关日志。
  getInputItemCount(body: any): number;

  // ── 日志/审计辅助 ──
  countInlineImageParts(body: any): number;
  summarizeEnabledTools(body: any): Record<string, unknown>;
  summarizeResponseMetadata(data: any): Record<string, unknown> | null;
  // 请求概要信息（用于日志前缀）
  describeRequest(cfg: AiConfig): { model: string; baseUrl: string };
  // 从响应中提取模型思考过程（thought parts），用于日志记录
  extractThoughtText(data: any): string;
}
