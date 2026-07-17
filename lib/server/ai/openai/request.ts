// OpenAI Responses API 请求体构建

import type { AiConfig, ChatOptions, HistoryItem } from '../types.js';

import * as imageCache from '../../image-cache.js';
import { imageRecordToPart } from '../gemini/image.js';
import { getBeijingTimeText, stripCqCodes } from '../utils.js';
import {
  MAX_IMAGES_PER_MESSAGE,
  NO_THOUGHT_LEAK_SYSTEM_INSTRUCTION,
  NO_UNREQUESTED_LINKS_SYSTEM_INSTRUCTION,
} from '../types.js';

export type OpenAIInputContent =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string; detail?: 'auto' | 'low' | 'high' | 'original' };

export type OpenAIRequestBody = {
  model: string;
  stream: true;
  instructions?: string;
  input: Array<Record<string, any>>;
  include?: string[];
  tools?: Array<Record<string, any>>;
  reasoning?: {
    effort: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  };
};

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_OPENAI_MODEL = 'gpt-5.6-sol';

function resolveOpenAIModel(cfg: AiConfig): string {
  const envModel = String(process.env.OPENAI_MODEL || '').trim();
  if (envModel) return envModel;
  const configured = String(cfg.ai_model || '').trim();
  if (configured && !/^gemini(?:-|$)/i.test(configured)) return configured;
  return DEFAULT_OPENAI_MODEL;
}

function resolveOpenAIBaseUrl(cfg: AiConfig): string {
  const envBaseUrl = String(process.env.OPENAI_BASE_URL || '').trim();
  if (envBaseUrl) return envBaseUrl.replace(/\/+$/, '');
  const configured = String(cfg.ai_base_url || '').trim();
  if (configured && !/generativelanguage\.googleapis\.com/i.test(configured)) {
    return configured.replace(/\/+$/, '');
  }
  return DEFAULT_OPENAI_BASE_URL;
}

function buildResponsesUrl(baseUrl: unknown): string {
  const normalized = String(baseUrl || DEFAULT_OPENAI_BASE_URL).trim().replace(/\/+$/, '');
  if (/\/responses$/i.test(normalized)) return normalized;
  if (/\/v1$/i.test(normalized)) return `${normalized}/responses`;
  return `${normalized}/v1/responses`;
}

function resolveOpenAIApiKey(cfg: AiConfig): string {
  return String(cfg.ai_api_key || process.env.OPENAI_API_KEY || '').trim();
}

function buildInstructions(systemPrompt: unknown, extraSystemInstruction: unknown = ''): string {
  return [
    getBeijingTimeText(),
    NO_THOUGHT_LEAK_SYSTEM_INSTRUCTION,
    NO_UNREQUESTED_LINKS_SYSTEM_INSTRUCTION,
    String(systemPrompt || '').trim(),
    String(extraSystemInstruction || '').trim(),
  ].filter(Boolean).join('\n');
}

function normalizeReasoningEffort(value: unknown): 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' {
  const normalized = String(value || '').trim().toLowerCase();
  if (
    normalized === 'none' ||
    normalized === 'low' ||
    normalized === 'medium' ||
    normalized === 'high' ||
    normalized === 'xhigh' ||
    normalized === 'max'
  ) {
    return normalized;
  }
  return 'medium';
}

function normalizeSearchContextSize(value: unknown): 'low' | 'medium' | 'high' {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'low' || normalized === 'high') return normalized;
  return 'medium';
}

function inlineDataToInputImage(value: unknown): OpenAIInputContent | null {
  const inlineData = (value as any)?.inline_data;
  if (!inlineData?.data) return null;
  const mimeType = String(inlineData.mime_type || 'image/jpeg').trim();
  return {
    type: 'input_image',
    image_url: `data:${mimeType};base64,${String(inlineData.data)}`,
    detail: 'auto',
  };
}

async function buildCurrentUserContent(
  userMessage: unknown,
  cfg: AiConfig,
  options: ChatOptions
): Promise<OpenAIInputContent[]> {
  const imageRecords = imageCache.extractImageRecords(userMessage, {
    ignoreStickers: cfg.ai_filter_stickers !== false,
    maxImages: MAX_IMAGES_PER_MESSAGE,
  });
  const text = stripCqCodes(userMessage) || (imageRecords.length ? '请分析这张图片。' : String(userMessage || ''));
  const content: OpenAIInputContent[] = [{ type: 'input_text', text }];

  if (options.autoAttachImages !== false) {
    for (const record of imageRecords) {
      const part = await imageRecordToPart(record);
      const image = inlineDataToInputImage(part);
      if (image) content.push(image);
    }
  }

  for (const part of Array.isArray(options.extraParts) ? options.extraParts : []) {
    const image = inlineDataToInputImage(part);
    if (image) content.push(image);
  }
  return content;
}

function buildHistory(history: unknown): Array<Record<string, any>> {
  const safeHistory = Array.isArray(history) ? history : [];
  return safeHistory
    .filter((item): item is HistoryItem => Boolean(
      item && (item.role === 'user' || item.role === 'model') && String(item.text || '').trim()
    ))
    .map((item) => ({
      role: item.role === 'model' ? 'assistant' : 'user',
      content: String(item.text),
    }));
}

function normalizeFunctionTools(declarations: unknown[]): Array<Record<string, any>> {
  return declarations
    .filter((item): item is Record<string, any> => Boolean(item && typeof item === 'object'))
    .filter((item) => Boolean(String(item.name || '').trim()))
    .map((item) => ({
      type: 'function',
      name: String(item.name),
      ...(item.description ? { description: String(item.description) } : {}),
      parameters: item.parameters && typeof item.parameters === 'object'
        ? item.parameters
        : { type: 'object', properties: {} },
    }));
}

function buildTools(cfg: AiConfig, declarations: unknown[]): Array<Record<string, any>> {
  const tools = normalizeFunctionTools(declarations);
  if (cfg.ai_web_search_enabled === true) {
    tools.push({
      type: 'web_search',
      search_context_size: normalizeSearchContextSize(cfg.ai_web_search_context_size),
    });
  }
  return tools;
}

async function buildRequestBody(
  userMessage: unknown,
  history: unknown,
  cfg: AiConfig,
  options: ChatOptions = {}
): Promise<OpenAIRequestBody> {
  const body: OpenAIRequestBody = {
    model: resolveOpenAIModel(cfg),
    stream: true,
    input: [
      ...buildHistory(history),
      {
        role: 'user',
        content: await buildCurrentUserContent(userMessage, cfg, options),
      },
    ],
  };

  const instructions = buildInstructions(cfg.ai_system_prompt, options.extraSystemInstruction);
  if (instructions) body.instructions = instructions;

  const tools = buildTools(cfg,
    Array.isArray(options.functionDeclarations) ? options.functionDeclarations : []
  );
  if (tools.length > 0) body.tools = tools;
  if (cfg.ai_web_search_enabled === true) {
    // 来源只用于后台工具审计，不再自动拼接到发给 QQ 用户的正文。
    body.include = ['web_search_call.action.sources'];
  }
  if (cfg.ai_thinking_enabled === true) {
    body.reasoning = { effort: normalizeReasoningEffort(cfg.ai_thinking_level) };
  }
  return body;
}

export {
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  buildRequestBody,
  buildResponsesUrl,
  inlineDataToInputImage,
  normalizeReasoningEffort,
  normalizeSearchContextSize,
  resolveOpenAIApiKey,
  resolveOpenAIBaseUrl,
  resolveOpenAIModel,
};
