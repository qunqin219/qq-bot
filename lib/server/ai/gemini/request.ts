// Gemini 请求体构建

import type {
  AiConfig,
  ChatOptions,
  ContentPart,
  GeminiContent,
  GeminiRequestBody,
  GeminiTool,
  HistoryItem,
} from '../types.js';

import * as imageCache from '../../image-cache.js';
import { imageRecordToPart } from './image.js';
import { stripCqCodes, getBeijingTimeText } from '../utils.js';
import {
  MAX_IMAGES_PER_MESSAGE,
  NO_THOUGHT_LEAK_SYSTEM_INSTRUCTION,
} from '../types.js';

function buildSystemInstruction(systemPrompt: unknown, extraSystemInstruction: unknown = ''): string {
  return [
    getBeijingTimeText(),
    NO_THOUGHT_LEAK_SYSTEM_INSTRUCTION,
    String(systemPrompt || '').trim(),
    String(extraSystemInstruction || '').trim(),
  ].filter(Boolean).join('\n');
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
    content.parts.length > 0
  );
}

function normalizeGeminiContentForRequest(value: unknown): GeminiContent | null {
  if (!isGeminiContent(value)) return null;
  const cloned = cloneJson(value);
  if (!isGeminiContent(cloned)) return null;
  return cloned;
}

function removeInlineDataFromContent(content: GeminiContent): GeminiContent {
  return {
    role: content.role,
    parts: content.parts
      .filter((part) => !(part as any).inline_data && (part as any).thought !== true)
      .map((part) => cloneJson(part) || part),
  };
}

function thinkingBudgetFromLevel(level: unknown): number {
  if (level === 'low') return 1024;
  if (level === 'high') return 8192;
  return 4096; // medium
}

function normalizeThinkingLevel(level: unknown): string {
  const text = String(level || '').trim().toLowerCase();
  if (text === 'minimal' || text === 'low' || text === 'medium' || text === 'high') return text;
  return 'medium';
}

function isGemini3Model(model: unknown): boolean {
  const normalized = String(model || '').trim().toLowerCase().replace(/^models\//, '');
  return /^gemini-3(?:[.-]|$)/.test(normalized);
}

function buildThinkingConfig(cfg: AiConfig): NonNullable<GeminiRequestBody['generationConfig']>['thinkingConfig'] {
  const thinkingConfig: NonNullable<GeminiRequestBody['generationConfig']>['thinkingConfig'] = {
    includeThoughts: true,
  };
  if (isGemini3Model(cfg.ai_model || 'gemini-3.5-flash')) {
    thinkingConfig.thinkingLevel = normalizeThinkingLevel(cfg.ai_thinking_level);
  } else {
    thinkingConfig.thinkingBudget = thinkingBudgetFromLevel(cfg.ai_thinking_level);
  }
  return thinkingConfig;
}

function buildTools(cfg: AiConfig, functionDeclarations: unknown[] = []): GeminiTool[] {
  const tools: GeminiTool[] = [];
  if (functionDeclarations.length > 0) {
    tools.push({ functionDeclarations });
  }
  if (cfg.ai_google_search_enabled === true) {
    tools.push({ googleSearch: {} });
  }
  if (cfg.ai_url_context_enabled === true) {
    tools.push({ urlContext: {} });
  }
  return tools;
}

async function buildCurrentUserParts(
  userMessage: unknown,
  cfg: AiConfig = {},
  options: ChatOptions = {}
): Promise<ContentPart[]> {
  const imageRecords = imageCache.extractImageRecords(userMessage, {
    ignoreStickers: cfg.ai_filter_stickers !== false,
    maxImages: MAX_IMAGES_PER_MESSAGE,
  });
  const text = stripCqCodes(userMessage) || (imageRecords.length ? '请分析这张图片。' : String(userMessage || ''));
  const parts: ContentPart[] = [{ text }];
  const extraParts = Array.isArray(options.extraParts)
    ? options.extraParts.filter((part): part is ContentPart => Boolean(part && typeof part === 'object'))
    : [];
  if (options.autoAttachImages === false) return [...parts, ...extraParts];

  for (const record of imageRecords) {
    const part = await imageRecordToPart(record);
    if (part) parts.push(part);
  }

  return [...parts, ...extraParts];
}

async function buildContents(
  userMessage: unknown,
  history: unknown,
  cfg: AiConfig = {},
  options: ChatOptions = {}
): Promise<GeminiContent[]> {
  const safeHistory = Array.isArray(history) ? history : [];
  const contents = safeHistory
    .filter((m): m is HistoryItem => Boolean(m && (m.role === 'user' || m.role === 'model') && m.text))
    .map((m): GeminiContent => {
      const nativeContent = normalizeGeminiContentForRequest((m as any).gemini_content);
      if (nativeContent && nativeContent.role === m.role) return nativeContent;
      return {
        role: m.role,
        parts: [{ text: String(m.text) }],
      };
    });

  contents.push({
    role: 'user',
    parts: await buildCurrentUserParts(userMessage, cfg, options),
  });

  return contents;
}

async function buildRequestBody(
  userMessage: unknown,
  history: unknown,
  cfg: AiConfig,
  options: ChatOptions = {}
): Promise<GeminiRequestBody> {
  const systemPrompt = cfg?.ai_system_prompt || '';
  const body: GeminiRequestBody = {
    contents: await buildContents(userMessage, history, cfg, options),
  };

  const systemInstruction = buildSystemInstruction(systemPrompt, options.extraSystemInstruction);
  if (systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  const generationConfig: GeminiRequestBody['generationConfig'] = {};
  if (cfg?.ai_thinking_enabled === true) {
    generationConfig.thinkingConfig = buildThinkingConfig(cfg);
  }
  if (Object.keys(generationConfig).length > 0) {
    body.generationConfig = generationConfig;
  }

  const functionDeclarations = Array.isArray(options.functionDeclarations)
    ? options.functionDeclarations
    : [];
  const tools = buildTools(cfg || {}, functionDeclarations);
  if (tools.length > 0) {
    body.tools = tools;
  }

  return body;
}

export {
  buildRequestBody,
  buildThinkingConfig,
  cloneJson,
  isGemini3Model,
  isGeminiContent,
  normalizeThinkingLevel,
  normalizeGeminiContentForRequest,
  removeInlineDataFromContent,
};
