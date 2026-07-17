// OpenAIProvider —— GPT-5.6 系列的 Responses API 实现

import type { LLMProvider } from '../provider.js';
import type { AiConfig, ToolResult } from '../types.js';
import type { OpenAIRequestBody } from './request.js';
import type { OpenAIResponse } from './response.js';
import { normalizeOpenAIStreamingResponse } from './stream.js';

import {
  buildRequestBody,
  buildResponsesUrl,
  resolveOpenAIApiKey,
  resolveOpenAIBaseUrl,
  resolveOpenAIModel,
} from './request.js';
import {
  appendToolResults,
  buildFunctionResponseParts,
  buildModelContentForHistory,
  countInlineImageParts,
  extractFunctionCalls,
  extractOutputText,
  extractThoughtText,
  getLastUserContent,
  removeInlineDataFromContent,
  summarizeEnabledTools,
  summarizeResponseMetadata,
} from './response.js';

const OpenAIProvider: LLMProvider = {
  name: 'openai',

  isConfigured(cfg: AiConfig) {
    return Boolean(resolveOpenAIApiKey(cfg));
  },

  async buildRequestBody(userMessage, history, cfg, options) {
    return buildRequestBody(userMessage, history, cfg, options);
  },

  async sendRequest(body: OpenAIRequestBody, cfg: AiConfig, signal?: AbortSignal): Promise<Response> {
    const response = await fetch(buildResponsesUrl(resolveOpenAIBaseUrl(cfg)), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resolveOpenAIApiKey(cfg)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });
    return normalizeOpenAIStreamingResponse(response);
  },

  extractFunctionCalls(data: OpenAIResponse) {
    return extractFunctionCalls(data);
  },

  extractOutputText(data: OpenAIResponse) {
    return extractOutputText(data);
  },

  getModelContent(data: OpenAIResponse) {
    return data;
  },

  buildFunctionResponseParts(results: ToolResult[]) {
    return buildFunctionResponseParts(results);
  },

  buildModelContentForHistory(content, reply, sanitizedReply) {
    return buildModelContentForHistory(content, reply, sanitizedReply);
  },

  removeInlineDataFromContent(content) {
    return removeInlineDataFromContent(content);
  },

  getLastUserContent(body: OpenAIRequestBody) {
    return getLastUserContent(body);
  },

  appendContents(body: OpenAIRequestBody, contents) {
    body.input.push(...contents);
  },

  appendUserMessage(body: OpenAIRequestBody, text: string) {
    body.input.push({ role: 'user', content: [{ type: 'input_text', text }] });
  },

  appendToolResults(body: OpenAIRequestBody, data: OpenAIResponse, results: ToolResult[]) {
    return appendToolResults(body, data, results);
  },

  getInputItemCount(body: OpenAIRequestBody) {
    return body.input.length;
  },

  countInlineImageParts(body: OpenAIRequestBody) {
    return countInlineImageParts(body);
  },

  summarizeEnabledTools(body: OpenAIRequestBody) {
    return summarizeEnabledTools(body);
  },

  summarizeResponseMetadata(data: OpenAIResponse) {
    return summarizeResponseMetadata(data);
  },

  describeRequest(cfg: AiConfig) {
    return {
      model: resolveOpenAIModel(cfg),
      baseUrl: resolveOpenAIBaseUrl(cfg),
    };
  },

  extractThoughtText(data: OpenAIResponse) {
    return extractThoughtText(data);
  },
};

export { OpenAIProvider };
