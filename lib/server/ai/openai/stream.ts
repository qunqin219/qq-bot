import type { OpenAIResponse } from './response.js';

type ParsedStream = {
  response: OpenAIResponse | null;
  error: Record<string, unknown> | null;
};

function record(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

function clone<T>(value: T): T | null {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return null;
  }
}

function parseSseBlock(block: string): Record<string, any> | null {
  const data = String(block || '')
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
    .trim();
  if (!data || data === '[DONE]') return null;
  try {
    return record(JSON.parse(data));
  } catch {
    return null;
  }
}

function parseSseEvents(text: string): Array<Record<string, any>> {
  const events: Array<Record<string, any>> = [];
  for (const block of String(text || '').split(/\r?\n\r?\n/)) {
    const event = parseSseBlock(block);
    if (event) events.push(event);
  }
  return events;
}

function ensureOutput(outputs: Array<Record<string, any>>, index: number, type: string): Record<string, any> {
  if (!outputs[index]) {
    outputs[index] = type === 'message'
      ? { type: 'message', role: 'assistant', content: [] }
      : { type };
  }
  return outputs[index];
}

function ensureTextContent(item: Record<string, any>, index: number): Record<string, any> {
  if (!Array.isArray(item.content)) item.content = [];
  if (!item.content[index]) item.content[index] = { type: 'output_text', text: '', annotations: [] };
  return item.content[index];
}

function parseOpenAIEventStream(text: string): ParsedStream {
  const events = parseSseEvents(text);
  const outputs: Array<Record<string, any>> = [];
  let completed: OpenAIResponse | null = null;
  let metadata: OpenAIResponse = {};
  let streamError: Record<string, unknown> | null = null;

  for (const event of events) {
    const type = String(event.type || '');
    const eventResponse = record(event.response);
    if (eventResponse) {
      metadata = {
        ...metadata,
        ...(eventResponse.id ? { id: eventResponse.id } : {}),
        ...(eventResponse.model ? { model: eventResponse.model } : {}),
        ...(eventResponse.status ? { status: eventResponse.status } : {}),
        ...(eventResponse.usage ? { usage: eventResponse.usage } : {}),
        ...(eventResponse.reasoning ? { reasoning: eventResponse.reasoning } : {}),
      };
    }
    if (type === 'error') {
      streamError = record(event.error) || event;
      continue;
    }
    if (type === 'response.failed') {
      streamError = record(eventResponse?.error) || eventResponse || event;
      continue;
    }
    if (type === 'response.completed' && eventResponse) {
      completed = clone(eventResponse) as OpenAIResponse | null;
      continue;
    }

    const outputIndex = Math.max(0, Number(event.output_index || 0));
    if (type === 'response.output_item.added' || type === 'response.output_item.done') {
      const item = clone(record(event.item));
      if (item) outputs[outputIndex] = item;
      continue;
    }
    if (type === 'response.output_text.delta') {
      const item = ensureOutput(outputs, outputIndex, 'message');
      const content = ensureTextContent(item, Math.max(0, Number(event.content_index || 0)));
      content.text = `${String(content.text || '')}${String(event.delta || '')}`;
      continue;
    }
    if (type === 'response.output_text.annotation.added') {
      const item = ensureOutput(outputs, outputIndex, 'message');
      const content = ensureTextContent(item, Math.max(0, Number(event.content_index || 0)));
      if (!Array.isArray(content.annotations)) content.annotations = [];
      const annotation = clone(record(event.annotation));
      if (annotation) content.annotations.push(annotation);
      continue;
    }
    if (type === 'response.function_call_arguments.delta') {
      const item = ensureOutput(outputs, outputIndex, 'function_call');
      item.arguments = `${String(item.arguments || '')}${String(event.delta || '')}`;
      continue;
    }
    if (type === 'response.reasoning_summary_text.delta') {
      const item = ensureOutput(outputs, outputIndex, 'reasoning');
      if (!Array.isArray(item.summary)) item.summary = [];
      const summaryIndex = Math.max(0, Number(event.summary_index || 0));
      if (!item.summary[summaryIndex]) item.summary[summaryIndex] = { type: 'summary_text', text: '' };
      item.summary[summaryIndex].text += String(event.delta || '');
    }
  }

  if (streamError) return { response: null, error: streamError };
  const response = completed || metadata;
  if ((!Array.isArray(response.output) || response.output.length === 0) && outputs.length > 0) {
    response.output = outputs.filter(Boolean);
  }
  return {
    response: Object.keys(response).length > 0 ? response : null,
    error: null,
  };
}

async function readEventStream(
  response: Response,
  onEvent?: (event: Record<string, any>) => Promise<void> | void
): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let raw = '';
  let buffer = '';

  const dispatch = async (block: string): Promise<void> => {
    const event = parseSseBlock(block);
    if (!event || !onEvent) return;
    try {
      await onEvent(event);
    } catch (error) {
      console.warn('[AI] OpenAI 流式事件回调失败，继续读取响应:', error);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    const text = decoder.decode(value, { stream: !done });
    raw += text;
    buffer += text;

    let separator = /\r?\n\r?\n/.exec(buffer);
    while (separator?.index !== undefined) {
      const block = buffer.slice(0, separator.index);
      buffer = buffer.slice(separator.index + separator[0].length);
      await dispatch(block);
      separator = /\r?\n\r?\n/.exec(buffer);
    }
    if (done) break;
  }

  if (buffer.trim()) await dispatch(buffer);
  return raw;
}

async function normalizeOpenAIStreamingResponse(
  response: Response,
  onEvent?: (event: Record<string, any>) => Promise<void> | void
): Promise<Response> {
  const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) return response;
  // Test doubles and a few compatible clients expose json()/text() but no body.
  // Leave those untouched so the model-agnostic loop can consume them normally.
  if (!response.body || typeof response.text !== 'function') return response;

  const raw = contentType.includes('text/event-stream') && typeof response.body.getReader === 'function'
    ? await readEventStream(response, onEvent)
    : await response.text();
  if (!contentType.includes('text/event-stream') && /^\s*(?:\{|\[)/.test(raw)) {
    const headers = new Headers(response.headers);
    headers.set('Content-Type', 'application/json');
    return new Response(raw, { status: response.status, statusText: response.statusText, headers });
  }
  const parsed = parseOpenAIEventStream(raw);
  if (parsed.error) {
    return new Response(JSON.stringify({ error: parsed.error }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!parsed.response) {
    return new Response(JSON.stringify({ error: { message: 'OpenAI 流式响应没有可解析的完成事件' } }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify(parsed.response), {
    status: response.status,
    statusText: response.statusText,
    headers: { 'Content-Type': 'application/json' },
  });
}

export { normalizeOpenAIStreamingResponse, parseOpenAIEventStream, parseSseEvents };
