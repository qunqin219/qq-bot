// Gemini AI 调用模块 —— generateContent 兼容格式，支持文字 + QQ 图片识别
//
// 说明：很多 Gemini 中转只兼容 generateContent，不支持官方新出的 Interactions API。
// 因此这里使用：POST {base_url}/models/{model}:generateContent?key={api_key}
//
// 兼容能力：
// - 上下文：contents = 历史消息 + 当前用户消息
// - 系统提示词：systemInstruction
// - 思考控制：generationConfig.thinkingConfig.thinkingBudget
// - Google Search：tools: [{ googleSearch: {} }]
// - URL Context：tools: [{ urlContext: {} }]
// - 识图：解析 QQ [CQ:image,...url=...]，下载后作为 inline_data 发给 Gemini

import type { ImageCacheEntry, ImageRecord } from './image-cache';

const fs = require('fs');
const imageCache = require('./image-cache');

const MAX_IMAGES_PER_MESSAGE = 3;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_TOOL_ROUNDS = 4;
const DEFAULT_MAX_TOOL_CALLS = 8;
const DEFAULT_MAX_FUNCTION_CALLS_PER_ROUND = 3;

type Role = 'user' | 'model';

type TextPart = { text: string };
type InlineDataPart = { inline_data: { mime_type: string; data: string } };
type FunctionResponsePart = { functionResponse: { name: string; response: unknown } };
type ContentPart = TextPart | InlineDataPart | FunctionResponsePart | Record<string, unknown>;

type GeminiContent = {
  role: Role;
  parts: ContentPart[];
};

type GeminiRequestBody = {
  contents: GeminiContent[];
  systemInstruction?: { parts: TextPart[] };
  generationConfig?: {
    thinkingConfig?: {
      thinkingBudget: number;
    };
  };
  tools?: GeminiTool[];
};

type GeminiTool =
  | { functionDeclarations: unknown[] }
  | { googleSearch: Record<string, never> }
  | { urlContext: Record<string, never> };

type GeminiFunctionCall = {
  name: string;
  args?: Record<string, unknown>;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: GeminiContent;
    groundingMetadata?: Record<string, any>;
    urlContextMetadata?: Record<string, any>;
  }>;
  urlContextMetadata?: Record<string, any>;
};

type HistoryItem = {
  role: Role;
  text: string;
};

type AiConfig = Record<string, any>;

type ToolResult = {
  name: string;
  response: any;
};

type ChatOptions = {
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
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getBeijingTimeText(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value || '';
  return `当前北京时间：${get('year')}年${get('month')}月${get('day')}日，${get('weekday')}，${get('hour')}:${get('minute')}:${get('second')}。`;
}

function buildSystemInstruction(systemPrompt: unknown, extraSystemInstruction: unknown = ''): string {
  return [
    getBeijingTimeText(),
    String(systemPrompt || '').trim(),
    String(extraSystemInstruction || '').trim(),
  ].filter(Boolean).join('\n');
}

function decodeHtmlEntities(text: unknown): string {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&#44;/g, ',')
    .replace(/&#91;/g, '[')
    .replace(/&#93;/g, ']')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

function isStickerMessage(message: unknown): boolean {
  const raw = decodeHtmlEntities(String(message || ''));
  return (
    /\[CQ:mface[,\]]/.test(raw) ||
    /\[CQ:image,[^\]]*(summary=\[动画表情\]|sub_type=1)/.test(raw)
  );
}

function extractImageUrls(message: unknown, options = {}): string[] {
  return imageCache.extractImageRecords(message, options)
    .map((record: ImageRecord) => record.url)
    .filter(Boolean)
    .slice(0, MAX_IMAGES_PER_MESSAGE);
}

function stripCqCodes(message: unknown): string {
  return decodeHtmlEntities(String(message || ''))
    .replace(/\[CQ:[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function imageUrlToPart(url: string): Promise<InlineDataPart | null> {
  try {
    const downloaded = await imageCache.downloadImage(url);
    if (!downloaded.ok) {
      console.warn(`[AI] 图片下载失败: ${downloaded.error}`);
      return null;
    }
    // generateContent REST 多模态字段；大多数中转兼容 inline_data。
    return {
      inline_data: {
        mime_type: downloaded.mimeType,
        data: downloaded.buffer.toString('base64'),
      },
    };
  } catch (e: unknown) {
    console.warn('[AI] 图片下载异常:', errorMessage(e));
    return null;
  }
}

function cachedImageToPart(entry: ImageCacheEntry | null): InlineDataPart | null {
  if (!entry?.file_path || !fs.existsSync(entry.file_path)) return null;
  const buf = fs.readFileSync(entry.file_path);
  if (buf.length > MAX_IMAGE_BYTES) {
    console.warn(`[AI] 缓存图片过大，已跳过: ${buf.length} bytes`);
    return null;
  }
  return {
    inline_data: {
      mime_type: entry.mime_type || 'image/jpeg',
      data: buf.toString('base64'),
    },
  };
}

async function imageRecordToPart(record: ImageRecord): Promise<InlineDataPart | null> {
  const cached = imageCache.getCachedImage(record);
  if (cached) {
    const part = cachedImageToPart(cached);
    if (part) return part;
  }

  // 当前消息里的 QQ URL 通常还没过期；这里顺手缓存，之后引用旧图就不依赖临时链接。
  const cachedNow = await imageCache.cacheImageRecord(record, { source: 'ai' });
  if (cachedNow) {
    const part = cachedImageToPart(cachedNow);
    if (part) return part;
  }

  return record.url ? imageUrlToPart(record.url) : null;
}

async function buildCurrentUserParts(userMessage: unknown, cfg: AiConfig = {}): Promise<ContentPart[]> {
  const imageRecords = imageCache.extractImageRecords(userMessage, {
    ignoreStickers: cfg.ai_filter_stickers !== false,
    maxImages: MAX_IMAGES_PER_MESSAGE,
  });
  const text = stripCqCodes(userMessage) || (imageRecords.length ? '请分析这张图片。' : String(userMessage || ''));
  const parts: ContentPart[] = [{ text }];

  for (const record of imageRecords) {
    const part = await imageRecordToPart(record);
    if (part) parts.push(part);
  }

  return parts;
}

async function buildContents(userMessage: unknown, history: unknown, cfg: AiConfig = {}): Promise<GeminiContent[]> {
  const safeHistory = Array.isArray(history) ? history : [];
  const contents = safeHistory
    .filter((m): m is HistoryItem => Boolean(m && (m.role === 'user' || m.role === 'model') && m.text))
    .map((m): GeminiContent => ({
      role: m.role,
      parts: [{ text: String(m.text) }],
    }));

  contents.push({
    role: 'user',
    parts: await buildCurrentUserParts(userMessage, cfg),
  });

  return contents;
}

function thinkingBudgetFromLevel(level: unknown): number {
  // generateContent 没有 Interactions API 的 thinking_level。
  // 用 thinkingBudget 做兼容映射：数值越大，思考越多；0 表示尽量关闭。
  if (level === 'low') return 1024;
  if (level === 'high') return 8192;
  return 4096; // medium
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

function extractFunctionCalls(data: GeminiResponse): GeminiFunctionCall[] {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts
    .filter((part): part is { functionCall: GeminiFunctionCall } => {
      const call = (part as any).functionCall;
      return Boolean(call && call.name);
    })
    .map((part) => part.functionCall);
}

function buildFunctionResponseParts(results: ToolResult[]): FunctionResponsePart[] {
  return results.map((item) => ({
    functionResponse: {
      name: item.name,
      response: item.response,
    },
  }));
}

function extractOutputText(data: GeminiResponse): string {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts
    .filter((part): part is TextPart => typeof (part as any).text === 'string' && Boolean((part as any).text))
    .map((part) => part.text)
    .join('')
    .trim();
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function toolCallKey(call: GeminiFunctionCall): string {
  return `${call.name}:${stableStringify(call.args || {})}`;
}

function fallbackToolMessages(toolResults: ToolResult[]): string | null {
  return toolResults
    .map((item) => item.response?.message)
    .filter(Boolean)
    .join('\n') || null;
}

async function buildRequestBody(
  userMessage: unknown,
  history: unknown,
  cfg: AiConfig,
  options: ChatOptions = {}
): Promise<GeminiRequestBody> {
  const systemPrompt = cfg?.ai_system_prompt || '';
  const body: GeminiRequestBody = {
    contents: await buildContents(userMessage, history, cfg),
  };

  const systemInstruction = buildSystemInstruction(systemPrompt, options.extraSystemInstruction);
  if (systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  const generationConfig: GeminiRequestBody['generationConfig'] = {};
  if (cfg?.ai_thinking_enabled === true) {
    generationConfig.thinkingConfig = {
      thinkingBudget: thinkingBudgetFromLevel(cfg.ai_thinking_level),
    };
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

function resolveNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

async function postGenerateContent(url: string, body: GeminiRequestBody): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function compactJson(value: unknown, maxLength = 900): string {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function previewText(value: unknown, maxLength = 220): string {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function countInlineImageParts(body: GeminiRequestBody): number {
  return (body.contents || []).reduce((count, content) => {
    return count + (content.parts || []).filter((part) => Boolean((part as any).inline_data)).length;
  }, 0);
}

function summarizeEnabledTools(body: GeminiRequestBody): Record<string, unknown> {
  const summary = {
    function_tools: [] as string[],
    google_search: false,
    url_context: false,
  };
  for (const tool of body.tools || []) {
    if ('functionDeclarations' in tool) {
      summary.function_tools.push(
        ...((tool.functionDeclarations || []) as Array<Record<string, any>>)
          .map((item) => item?.name || '(anonymous)')
      );
    }
    if ('googleSearch' in tool) summary.google_search = true;
    if ('urlContext' in tool) summary.url_context = true;
  }
  return summary;
}

function summarizeRequestedFunctionCalls(calls: GeminiFunctionCall[]): Array<Record<string, unknown>> {
  return calls.map((call) => ({
    name: call.name,
    args: call.args || {},
  }));
}

function summarizeResponseMetadata(data: GeminiResponse): Record<string, unknown> | null {
  const candidate = data?.candidates?.[0] || {};
  const grounding = candidate.groundingMetadata;
  const urlContext = candidate.urlContextMetadata || data.urlContextMetadata;
  const summary: Record<string, unknown> = {};

  if (grounding) {
    if (Array.isArray(grounding.webSearchQueries)) {
      summary.web_search_queries = grounding.webSearchQueries.slice(0, 5);
    }
    if (Array.isArray(grounding.groundingChunks)) {
      summary.grounding_chunks = grounding.groundingChunks.length;
    }
    if (Array.isArray(grounding.groundingSupports)) {
      summary.grounding_supports = grounding.groundingSupports.length;
    }
    if (grounding.searchEntryPoint) {
      summary.search_entry_point = true;
    }
  }

  if (urlContext) {
    if (Array.isArray(urlContext.urlMetadata)) {
      summary.url_context_items = urlContext.urlMetadata.length;
      summary.url_context_statuses = urlContext.urlMetadata.slice(0, 5).map((item: Record<string, any>) => ({
        url: item.retrievedUrl || item.url,
        status: item.urlRetrievalStatus || item.status,
      }));
    } else {
      summary.url_context = true;
    }
  }

  return Object.keys(summary).length > 0 ? summary : null;
}

/**
 * 调用 Gemini generateContent 生成 AI 回复。
 *
 * @param {string} userMessage - 当前用户消息文本，允许包含 QQ CQ 图片码
 * @param {Array} history - 本地会话历史，格式 [{ role: 'user'|'model', text: '...' }]
 * @param {object} cfg - 配置对象
 * @param {object} options - 可选工具调用配置：{ functionDeclarations, executeFunctionCall }
 * @returns {Promise<string|null>} AI 回复文本；未配置或调用失败时返回 null
 */
async function chat(
  userMessage: unknown,
  history: unknown,
  cfg: AiConfig,
  options: ChatOptions = {}
): Promise<string | null> {
  if (!cfg || cfg.ai_enabled !== true || !String(cfg.ai_api_key || '').trim()) {
    return null;
  }

  const baseUrl = (cfg.ai_base_url || 'https://generativelanguage.googleapis.com/v1beta')
    .replace(/\/+$/, '');
  const model = cfg.ai_model || 'gemini-3.5-flash';
  const apiKey = String(cfg.ai_api_key || '').trim();
  const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const maxToolRounds = resolveNumber(options.maxToolRounds, DEFAULT_MAX_TOOL_ROUNDS, 1, 8);
  const maxToolCalls = resolveNumber(options.maxToolCalls, DEFAULT_MAX_TOOL_CALLS, 1, 20);
  const maxCallsPerRound = resolveNumber(
    options.maxCallsPerRound,
    DEFAULT_MAX_FUNCTION_CALLS_PER_ROUND,
    1,
    5
  );

  const body = await buildRequestBody(userMessage, history, cfg, options);
  const seenToolCalls = new Set();
  const allToolResults: ToolResult[] = [];
  let executedToolCalls = 0;
  const requestStartedAt = Date.now();

  console.log(
    `[AI] Gemini 请求开始 model=${model} base_url=${baseUrl} contents=${body.contents.length} ` +
    `image_parts=${countInlineImageParts(body)} tools=${compactJson(summarizeEnabledTools(body))} ` +
    `max_rounds=${maxToolRounds} max_tool_calls=${maxToolCalls}`
  );

  try {
    for (let round = 1; round <= maxToolRounds + 1; round += 1) {
      const roundStartedAt = Date.now();
      console.log(`[AI] Gemini 第${round}轮请求开始 contents=${body.contents.length} executed_tool_calls=${executedToolCalls}`);
      const resp = await postGenerateContent(url, body);
      console.log(`[AI] Gemini 第${round}轮响应 status=${resp.status} duration_ms=${Date.now() - roundStartedAt}`);
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        console.error(
          `[AI] Gemini generateContent 第${round}轮返回错误 ${resp.status}: ${errText.slice(0, 500)}`
        );
        return fallbackToolMessages(allToolResults);
      }

      const data = await resp.json() as GeminiResponse;
      const functionCalls = extractFunctionCalls(data);
      const reply = extractOutputText(data);
      const responseMetadata = summarizeResponseMetadata(data);
      if (responseMetadata) {
        console.log(`[ToolAudit] builtin_metadata round=${round} ${compactJson(responseMetadata)}`);
      }
      if (functionCalls.length === 0 || typeof options.executeFunctionCall !== 'function') {
        if (reply) {
          console.log(
            `[AI] Gemini 回复完成 duration_ms=${Date.now() - requestStartedAt} rounds=${round} ` +
            `tool_calls=${executedToolCalls} reply_chars=${reply.length} reply_preview="${previewText(reply)}"`
          );
          return reply;
        }
        console.warn('[AI] Gemini 返回空回复:', JSON.stringify(data).slice(0, 500));
        return fallbackToolMessages(allToolResults);
      }

      console.log(
        `[ToolAudit] model_requested round=${round} requested=${compactJson(summarizeRequestedFunctionCalls(functionCalls))}`
      );

      if (round > maxToolRounds || executedToolCalls >= maxToolCalls) {
        console.warn(`[AI] 工具调用达到限制 round=${round} executed=${executedToolCalls}`);
        return reply || fallbackToolMessages(allToolResults);
      }

      const roundToolResults: ToolResult[] = [];
      const remainingCalls = Math.max(0, maxToolCalls - executedToolCalls);
      const callsToRun = functionCalls.slice(0, Math.min(maxCallsPerRound, remainingCalls));
      if (functionCalls.length > callsToRun.length) {
        console.warn(
          `[ToolAudit] 本轮工具调用超过限制 round=${round} requested=${functionCalls.length} running=${callsToRun.length}`
        );
      }

      for (const [index, call] of callsToRun.entries()) {
        const key = toolCallKey(call);
        if (seenToolCalls.has(key)) {
          console.warn(`[ToolAudit] duplicate_skipped round=${round} name=${call.name} args=${compactJson(call.args || {})}`);
          roundToolResults.push({
            name: call.name,
            response: {
              ok: false,
              duplicate: true,
              message: '重复工具调用已跳过，请根据已有工具结果回答，不要重复调用同名同参数工具',
            },
          });
          continue;
        }

        seenToolCalls.add(key);
        executedToolCalls += 1;
        const response = await options.executeFunctionCall(call.name, call.args || {}, {
          round,
          index: index + 1,
          executedToolCalls,
        });
        const item = { name: call.name, response };
        roundToolResults.push(item);
        allToolResults.push(item);
      }

      if (roundToolResults.length === 0) {
        console.warn('[AI] 模型请求工具但没有可执行调用，停止工具循环');
        return reply || fallbackToolMessages(allToolResults);
      }

      if (!data.candidates?.[0]?.content) {
        console.warn('[AI] 模型请求工具但缺少候选内容，停止工具循环');
        return reply || fallbackToolMessages(allToolResults);
      }

      body.contents = [
        ...body.contents,
        data.candidates[0].content,
        {
          role: 'user',
          parts: buildFunctionResponseParts(roundToolResults),
        },
      ];
    }

    console.warn(
      `[AI] Gemini 工具循环结束但没有最终文本 duration_ms=${Date.now() - requestStartedAt} ` +
      `tool_calls=${executedToolCalls}`
    );
    return fallbackToolMessages(allToolResults);
  } catch (e: unknown) {
    console.error('[AI] 调用 Gemini generateContent 异常:', errorMessage(e));
    return fallbackToolMessages(allToolResults);
  }
}

module.exports = { chat, stripCqCodes, extractImageUrls, isStickerMessage, buildRequestBody };
