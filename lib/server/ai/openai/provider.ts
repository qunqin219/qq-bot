// OpenAIProvider —— GPT-5.6 系列的 Responses API 实现

import type { LLMProvider, PrepareToolResultsOptions, ProviderRequestOptions } from '../provider.js';
import type { AiConfig, ToolResult } from '../types.js';
import type { OpenAIRequestBody } from './request.js';
import type { OpenAIResponse } from './response.js';
import { normalizeOpenAIStreamingResponse } from './stream.js';

import {
  buildRequestBody,
  buildResponsesUrl,
  normalizeReasoningEffort,
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
  extractBuiltinToolCalls,
  extractOutputText,
  extractThoughtText,
  getLastUserContent,
  removeInlineDataFromContent,
  splitToolResponse,
  summarizeEnabledTools,
  summarizeResponseMetadata,
} from './response.js';

async function sendOpenAIRequest(
  body: OpenAIRequestBody,
  cfg: AiConfig,
  options: ProviderRequestOptions = {}
): Promise<Response> {
  const response = await fetch(buildResponsesUrl(resolveOpenAIBaseUrl(cfg)), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resolveOpenAIApiKey(cfg)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  let webSearchStarted = false;
  return normalizeOpenAIStreamingResponse(response, async (event) => {
    const eventType = String(event.type || '');
    const isWebSearchStart = (
      eventType === 'response.output_item.added' && event.item?.type === 'web_search_call'
    ) || eventType === 'response.web_search_call.in_progress' || eventType === 'response.web_search_call.searching';
    if (!webSearchStarted && isWebSearchStart) {
      webSearchStarted = true;
      await options.onStreamEvent?.({ type: 'builtin_tool.started', tool: 'web_search' });
    }
  });
}

function imageReaderPrompt(result: ToolResult, userMessage: unknown): string {
  return [
    `你正在为主 Agent 执行 ${result.name} 图片读取。`,
    '只分析下面这次工具返回的原始图片，不要参考、猜测或混入其他图片。',
    '准确描述图片的主体与关键信息；若图片含文字，尽可能转述所有能辨认的文字。',
    '看不清的局部请明确说明，不要虚构内容。只输出图片识别结果，不要调用工具或搜索。',
    `主 Agent 当前需要回答的用户请求：${String(userMessage || '').trim().slice(0, 1000) || '(未提供)'}`,
  ].join('\n');
}

async function prepareToolResults(
  results: ToolResult[],
  cfg: AiConfig,
  options: PrepareToolResultsOptions = {}
): Promise<ToolResult[]> {
  const prepared: ToolResult[] = [];
  for (const result of results) {
    const { publicResponse, images } = splitToolResponse(result.response);
    if (images.length === 0) {
      prepared.push(result);
      continue;
    }

    const body: OpenAIRequestBody = {
      model: resolveOpenAIModel(cfg),
      stream: true,
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: imageReaderPrompt(result, options.userMessage) },
          ...images.map((image) => ({ ...image, detail: 'original' as const })),
        ],
      }],
      ...(cfg.ai_thinking_enabled === true
        ? { reasoning: { effort: normalizeReasoningEffort(cfg.ai_thinking_level) } }
        : {}),
    };

    try {
      console.log(`[ToolAudit] openai_image_reader_start name=${result.name} images=${images.length}`);
      const response = await sendOpenAIRequest(body, cfg, { signal: options.signal });
      if (!response.ok) {
        const error = await response.text().catch(() => '');
        console.warn(
          `[ToolAudit] openai_image_reader_failed name=${result.name} status=${response.status} ` +
          `error=${String(error).replace(/\s+/g, ' ').slice(0, 300)}`
        );
        prepared.push(result);
        continue;
      }
      const data = await response.json() as OpenAIResponse;
      const analysis = extractOutputText(data).trim();
      if (!analysis) {
        console.warn(`[ToolAudit] openai_image_reader_empty name=${result.name}`);
        prepared.push(result);
        continue;
      }
      console.log(`[ToolAudit] openai_image_reader_complete name=${result.name} chars=${analysis.length}`);
      prepared.push({
        ...result,
        response: {
          ...(publicResponse && typeof publicResponse === 'object' && !Array.isArray(publicResponse)
            ? publicResponse
            : { result: publicResponse }),
          image_analysis: analysis,
        },
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      console.warn(`[ToolAudit] openai_image_reader_exception name=${result.name}:`, error);
      prepared.push(result);
    }
  }
  return prepared;
}

const OpenAIProvider: LLMProvider = {
  name: 'openai',

  isConfigured(cfg: AiConfig) {
    return Boolean(resolveOpenAIApiKey(cfg));
  },

  async buildRequestBody(userMessage, history, cfg, options) {
    return buildRequestBody(userMessage, history, cfg, options);
  },

  async sendRequest(body: OpenAIRequestBody, cfg: AiConfig, options = {}): Promise<Response> {
    return sendOpenAIRequest(body, cfg, options);
  },

  extractFunctionCalls(data: OpenAIResponse) {
    return extractFunctionCalls(data);
  },

  extractOutputText(data: OpenAIResponse) {
    return extractOutputText(data);
  },

  extractBuiltinToolCalls(data: OpenAIResponse) {
    return extractBuiltinToolCalls(data);
  },

  getModelContent(data: OpenAIResponse) {
    return data;
  },

  buildFunctionResponseParts(results: ToolResult[]) {
    return buildFunctionResponseParts(results);
  },

  async prepareToolResults(results, cfg, options) {
    return prepareToolResults(results, cfg, options);
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
