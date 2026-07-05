// Gemini 响应解析

import type {
  ContentPart,
  GeminiContent,
  GeminiFunctionCall,
  GeminiRequestBody,
  GeminiResponse,
  InlineDataPart,
  SanitizedReply,
  TextPart,
  ToolResult,
} from '../types.js';

import { INTERNAL_INLINE_PARTS_FIELD } from '../types.js';
import { normalizeGeminiContentForRequest, removeInlineDataFromContent } from './request.js';

function extractFunctionCalls(data: GeminiResponse): GeminiFunctionCall[] {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts
    .filter((part): part is { functionCall: GeminiFunctionCall } => {
      const call = (part as any).functionCall;
      return Boolean(call && call.name);
    })
    .map((part) => part.functionCall);
}

function splitToolResponse(response: any): { publicResponse: any; inlineParts: InlineDataPart[] } {
  const inlineParts = Array.isArray(response?.[INTERNAL_INLINE_PARTS_FIELD])
    ? response[INTERNAL_INLINE_PARTS_FIELD].filter((part: any): part is InlineDataPart => Boolean(part?.inline_data?.data))
    : [];
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    return { publicResponse: response, inlineParts };
  }

  const { [INTERNAL_INLINE_PARTS_FIELD]: _hidden, ...publicResponse } = response;
  return { publicResponse, inlineParts };
}

function buildFunctionResponseParts(results: ToolResult[]): ContentPart[] {
  const parts: ContentPart[] = [];
  for (const item of results) {
    const { publicResponse, inlineParts } = splitToolResponse(item.response);
    parts.push({
      functionResponse: {
        name: item.name,
        response: publicResponse,
      },
    });
    parts.push(...inlineParts);
  }
  return parts;
}

function extractOutputText(data: GeminiResponse): string {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts
    .filter((part): part is TextPart => {
      const item = part as any;
      return item.thought !== true && typeof item.text === 'string' && Boolean(item.text);
    })
    .map((part) => part.text)
    .join('')
    .trim();
}

function buildModelContentForHistory(
  content: GeminiContent | undefined,
  reply: string,
  sanitizedReply: SanitizedReply
): GeminiContent {
  if (!content || sanitizedReply.leaked) {
    return { role: 'model', parts: [{ text: reply }] };
  }

  const cloned = normalizeGeminiContentForRequest(content);
  if (!cloned) return { role: 'model', parts: [{ text: reply }] };

  // Official Gemini thought signatures are opaque metadata. Keep the parts intact
  // only when the visible text was already safe; thought summary text is not stored.
  const sanitizedContent = removeInlineDataFromContent(cloned);
  return sanitizedContent.parts.length > 0 ? sanitizedContent : { role: 'model', parts: [{ text: reply }] };
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

function extractThoughtText(data: GeminiResponse): string {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts
    .filter((part: any) => part.thought === true && typeof part.text === 'string' && Boolean(part.text))
    .map((part: any) => part.text)
    .join('\n')
    .trim();
}

export {
  extractFunctionCalls,
  buildFunctionResponseParts,
  extractOutputText,
  extractThoughtText,
  buildModelContentForHistory,
  countInlineImageParts,
  summarizeEnabledTools,
  summarizeResponseMetadata,
};
