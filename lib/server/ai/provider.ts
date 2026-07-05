// LLMProvider 接口 —— 抽象不同 AI 模型提供商的差异
//
// chat() 工具循环通过此接口与具体模型交互。
// 目前只有 GeminiProvider 实现，未来可扩展 OpenAI/Claude 等。

import type { AiConfig, ChatOptions, FunctionCall, SanitizedReply, ToolResult } from './types.js';

export interface LLMProvider {
  readonly name: string;

  // 构建请求体
  buildRequestBody(
    userMessage: unknown,
    history: unknown,
    cfg: AiConfig,
    options: ChatOptions
  ): Promise<any>;

  // 发送 HTTP 请求，返回原始 Response
  sendRequest(body: any, cfg: AiConfig): Promise<Response>;

  // 从响应中提取函数调用
  extractFunctionCalls(data: any): FunctionCall[];

  // 从响应中提取可见文本
  extractOutputText(data: any): string;

  // 从响应中获取模型内容对象（用于追加到请求体和历史记录）
  getModelContent(data: any): any | undefined;

  // 构建函数响应 parts
  buildFunctionResponseParts(results: ToolResult[]): any[];

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

  // ── 日志/审计辅助 ──
  countInlineImageParts(body: any): number;
  summarizeEnabledTools(body: any): Record<string, unknown>;
  summarizeResponseMetadata(data: any): Record<string, unknown> | null;
  // 请求概要信息（用于日志前缀）
  describeRequest(cfg: AiConfig): { model: string; baseUrl: string };
  // 从响应中提取模型思考过程（thought parts），用于日志记录
  extractThoughtText(data: any): string;
}
