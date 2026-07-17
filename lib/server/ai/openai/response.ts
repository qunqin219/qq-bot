// OpenAI Responses API 响应解析与工具循环续接

import type { FunctionCall, SanitizedReply, ToolResult } from '../types.js';
import type { OpenAIInputContent, OpenAIRequestBody } from './request.js';

import { INTERNAL_INLINE_PARTS_FIELD } from '../types.js';
import { inlineDataToInputImage } from './request.js';

export type OpenAIResponse = {
  id?: string;
  model?: string;
  status?: string;
  output_text?: string;
  output?: Array<Record<string, any>>;
  usage?: Record<string, any>;
  reasoning?: Record<string, any>;
};

type WebCitation = {
  title: string;
  url: string;
};

function cloneJson<T>(value: T): T | null {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return null;
  }
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function extractFunctionCalls(data: OpenAIResponse): FunctionCall[] {
  return (data.output || [])
    .filter((item) => item?.type === 'function_call' && item.name && item.call_id)
    .map((item) => ({
      callId: String(item.call_id),
      name: String(item.name),
      args: parseArguments(item.arguments),
    }));
}

function safeCitationUrl(value: unknown): string {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function citationTitle(value: unknown): string {
  return String(value || '')
    .replace(/\[CQ:/gi, '[CQ：')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function extractCitations(data: OpenAIResponse): WebCitation[] {
  const citations: WebCitation[] = [];
  const seen = new Set<string>();
  for (const item of data.output || []) {
    if (item?.type !== 'message') continue;
    for (const content of Array.isArray(item.content) ? item.content : []) {
      for (const annotation of Array.isArray(content?.annotations) ? content.annotations : []) {
        if (annotation?.type !== 'url_citation') continue;
        const url = safeCitationUrl(annotation.url);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        citations.push({ title: citationTitle(annotation.title), url });
      }
    }
  }
  return citations.slice(0, 8);
}

function appendCitations(text: string, citations: WebCitation[]): string {
  if (!text || citations.length === 0) return text;
  const lines = citations.map((citation) => (
    citation.title ? `- ${citation.title}\n  ${citation.url}` : `- ${citation.url}`
  ));
  return `${text}\n\n来源：\n${lines.join('\n')}`;
}

function extractOutputText(data: OpenAIResponse): string {
  const chunks: string[] = [];
  for (const item of data.output || []) {
    if (item?.type !== 'message') continue;
    for (const content of Array.isArray(item.content) ? item.content : []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') {
        chunks.push(content.text);
      }
    }
  }
  const text = (chunks.join('') || String(data.output_text || '')).trim();
  return appendCitations(text, extractCitations(data));
}

function splitToolResponse(response: any): { publicResponse: any; images: OpenAIInputContent[] } {
  const images = Array.isArray(response?.[INTERNAL_INLINE_PARTS_FIELD])
    ? response[INTERNAL_INLINE_PARTS_FIELD]
      .map((part: unknown) => inlineDataToInputImage(part))
      .filter((part: OpenAIInputContent | null): part is OpenAIInputContent => Boolean(part))
    : [];
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    return { publicResponse: response, images };
  }
  const { [INTERNAL_INLINE_PARTS_FIELD]: _hidden, ...publicResponse } = response;
  return { publicResponse, images };
}

function serializeToolOutput(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return String(value ?? '');
  }
}

function buildFunctionResponseParts(results: ToolResult[]): Array<Record<string, any>> {
  return results
    .filter((item) => Boolean(item.callId))
    .map((item) => {
      const { publicResponse } = splitToolResponse(item.response);
      return {
        type: 'function_call_output',
        call_id: String(item.callId),
        output: serializeToolOutput(publicResponse),
      };
    });
}

function appendToolResults(
  body: OpenAIRequestBody,
  data: OpenAIResponse,
  results: ToolResult[]
): boolean {
  const output = (data.output || [])
    .map((item) => cloneJson(item))
    .filter((item): item is Record<string, any> => Boolean(item));
  const functionOutputs = buildFunctionResponseParts(results);
  if (output.length === 0 || functionOutputs.length !== results.length) return false;

  body.input.push(...output, ...functionOutputs);
  const images = results.flatMap((item) => splitToolResponse(item.response).images);
  if (images.length > 0) {
    body.input.push({
      role: 'user',
      content: [
        { type: 'input_text', text: '下面是刚才工具返回的图片，请结合对应工具结果继续回答。' },
        ...images,
      ],
    });
  }
  return true;
}

function messageText(item: Record<string, any> | undefined): string {
  if (!item) return '';
  if (typeof item.content === 'string') return item.content;
  return (Array.isArray(item.content) ? item.content : [])
    .filter((content: any) => content?.type === 'input_text' && typeof content.text === 'string')
    .map((content: any) => content.text)
    .join('\n')
    .trim();
}

function getLastUserContent(body: OpenAIRequestBody): Record<string, any> {
  const item = [...body.input].reverse().find((entry) => entry?.role === 'user');
  return { role: 'user', parts: [{ text: messageText(item) }] };
}

function buildModelContentForHistory(
  _content: unknown,
  reply: string,
  _sanitizedReply: SanitizedReply
): Record<string, any> {
  return { role: 'model', parts: [{ text: reply }] };
}

function removeInlineDataFromContent(content: any): any {
  if (!content || !Array.isArray(content.parts)) return content;
  return {
    ...content,
    parts: content.parts.filter((part: any) => !part?.inline_data),
  };
}

function countInlineImageParts(body: OpenAIRequestBody): number {
  return body.input.reduce((count, item) => {
    const content = Array.isArray(item?.content) ? item.content : [];
    return count + content.filter((part: any) => part?.type === 'input_image').length;
  }, 0);
}

function summarizeEnabledTools(body: OpenAIRequestBody): Record<string, unknown> {
  const webSearch = (body.tools || []).find((tool) => tool?.type === 'web_search');
  return {
    function_tools: (body.tools || [])
      .filter((tool) => tool?.type === 'function')
      .map((tool) => String(tool.name || '(anonymous)')),
    web_search: Boolean(webSearch),
    ...(webSearch ? { web_search_context_size: webSearch.search_context_size || 'medium' } : {}),
  };
}

function summarizeResponseMetadata(data: OpenAIResponse): Record<string, unknown> | null {
  const summary: Record<string, unknown> = {};
  if (data.id) summary.response_id = data.id;
  if (data.model) summary.model = data.model;
  if (data.status) summary.status = data.status;
  const webSearchCalls = (data.output || []).filter((item) => item?.type === 'web_search_call');
  if (webSearchCalls.length > 0) {
    summary.web_search_calls = webSearchCalls.length;
    summary.web_search_actions = webSearchCalls
      .map((item) => item.action?.type)
      .filter(Boolean);
    summary.web_search_queries = webSearchCalls
      .flatMap((item) => item.action?.queries || (item.action?.query ? [item.action.query] : []))
      .slice(0, 10);
    summary.web_search_sources = webSearchCalls
      .reduce((count, item) => count + (Array.isArray(item.action?.sources) ? item.action.sources.length : 0), 0);
  }
  if (data.usage) {
    summary.input_tokens = data.usage.input_tokens;
    summary.output_tokens = data.usage.output_tokens;
    summary.reasoning_tokens = data.usage.output_tokens_details?.reasoning_tokens;
    summary.cached_tokens = data.usage.input_tokens_details?.cached_tokens;
  }
  return Object.values(summary).some((value) => value !== undefined) ? summary : null;
}

function extractThoughtText(data: OpenAIResponse): string {
  return (data.output || [])
    .filter((item) => item?.type === 'reasoning')
    .flatMap((item) => Array.isArray(item.summary) ? item.summary : [])
    .filter((item) => item?.type === 'summary_text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n')
    .trim();
}

export {
  appendCitations,
  appendToolResults,
  buildFunctionResponseParts,
  buildModelContentForHistory,
  countInlineImageParts,
  extractFunctionCalls,
  extractCitations,
  extractOutputText,
  extractThoughtText,
  getLastUserContent,
  removeInlineDataFromContent,
  summarizeEnabledTools,
  summarizeResponseMetadata,
};
