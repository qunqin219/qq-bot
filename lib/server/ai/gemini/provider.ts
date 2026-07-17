// GeminiProvider —— LLMProvider 接口的 Gemini 实现
//
// 封装 Gemini generateContent REST API 的所有模型特定逻辑：
// URL 构造、请求体格式、响应解析、工具调用协议、inline_data 多模态格式。

import type { LLMProvider } from '../provider.js';
import type { AiConfig, GeminiRequestBody, GeminiResponse, ToolResult } from '../types.js';

import {
  buildRequestBody as geminiBuildRequestBody,
  removeInlineDataFromContent,
} from './request.js';
import {
  extractFunctionCalls as geminiExtractFunctionCalls,
  buildFunctionResponseParts as geminiBuildFunctionResponseParts,
  extractOutputText as geminiExtractOutputText,
  extractThoughtText as geminiExtractThoughtText,
  buildModelContentForHistory as geminiBuildModelContentForHistory,
  countInlineImageParts as geminiCountInlineImageParts,
  summarizeEnabledTools as geminiSummarizeEnabledTools,
  summarizeResponseMetadata as geminiSummarizeResponseMetadata,
} from './response.js';

const GeminiProvider: LLMProvider = {
  name: 'gemini',

  isConfigured(cfg: AiConfig) {
    return Boolean(String(cfg.ai_api_key || '').trim());
  },

  async buildRequestBody(userMessage, history, cfg, options) {
    return geminiBuildRequestBody(userMessage, history, cfg, options);
  },

  async sendRequest(body, cfg: AiConfig, signal?: AbortSignal): Promise<Response> {
    const baseUrl = (cfg.ai_base_url || 'https://generativelanguage.googleapis.com/v1beta')
      .replace(/\/+$/, '');
    const model = cfg.ai_model || 'gemini-3.5-flash';
    const apiKey = String(cfg.ai_api_key || '').trim();
    const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  },

  extractFunctionCalls(data: GeminiResponse) {
    return geminiExtractFunctionCalls(data);
  },

  extractOutputText(data: GeminiResponse) {
    return geminiExtractOutputText(data);
  },

  getModelContent(data: GeminiResponse) {
    return data?.candidates?.[0]?.content;
  },

  buildFunctionResponseParts(results: ToolResult[]) {
    return geminiBuildFunctionResponseParts(results);
  },

  buildModelContentForHistory(content, reply, sanitizedReply) {
    return geminiBuildModelContentForHistory(content, reply, sanitizedReply);
  },

  removeInlineDataFromContent(content) {
    return removeInlineDataFromContent(content);
  },

  getLastUserContent(body: GeminiRequestBody) {
    return removeInlineDataFromContent(body.contents[body.contents.length - 1]);
  },

  appendContents(body: GeminiRequestBody, contents) {
    body.contents = [...body.contents, ...contents];
  },

  appendUserMessage(body: GeminiRequestBody, text: string) {
    body.contents = [...body.contents, { role: 'user', parts: [{ text }] }];
  },

  appendToolResults(body: GeminiRequestBody, data: GeminiResponse, results: ToolResult[]) {
    const modelContent = data?.candidates?.[0]?.content;
    if (!modelContent) return false;
    body.contents = [
      ...body.contents,
      modelContent,
      { role: 'user', parts: geminiBuildFunctionResponseParts(results) },
    ];
    return true;
  },

  getInputItemCount(body: GeminiRequestBody) {
    return body.contents.length;
  },

  countInlineImageParts(body: GeminiRequestBody) {
    return geminiCountInlineImageParts(body);
  },

  summarizeEnabledTools(body: GeminiRequestBody) {
    return geminiSummarizeEnabledTools(body);
  },

  summarizeResponseMetadata(data: GeminiResponse) {
    return geminiSummarizeResponseMetadata(data);
  },

  describeRequest(cfg: AiConfig) {
    return {
      model: cfg.ai_model || 'gemini-3.5-flash',
      baseUrl: (cfg.ai_base_url || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, ''),
    };
  },

  extractThoughtText(data: GeminiResponse) {
    return geminiExtractThoughtText(data);
  },
};

export { GeminiProvider };
