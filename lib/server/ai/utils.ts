// 模型无关的工具函数 —— CQ 码处理、文本格式化、工具去重等

import type { FunctionCall } from './types.js';
import type { ImageRecord } from '../image-cache.js';

import * as imageCache from '../image-cache.js';
import { MAX_IMAGES_PER_MESSAGE } from './types.js';

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

// 把可能包含换行的原始文本（比如网关返回的 HTML 错误页）压成单行摘要，
// 避免这类内容按换行拆成一堆丢了 [AI] 模块标签的裸行，把日志搅乱。
function oneLinePreview(text: unknown, maxLength = 300): string {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > maxLength ? `${flat.slice(0, maxLength)}...` : flat;
}

function stripCqCodes(message: unknown): string {
  // 先去掉 CQ 码，再解码 HTML 实体——顺序不能反。
  // CQ 码参数值里的 `,` `[` `]` `&` 会被转义成 &#44;/&#91;/&#93;/&amp;，
  // 如果先解码，图片 URL 等参数里一旦还原出裸的 `]`，会让下面这个基于
  // `[^\]]+\]` 的正则提前收尾，导致 CQ 码只删掉一半，剩下的原始 URL/参数
  // 碎片就会泄漏到日志、AI 上下文和历史记录里。
  const withoutCqCodes = String(message || '').replace(/\[CQ:[^\]]+\]/g, '');
  return decodeHtmlEntities(withoutCqCodes).replace(/\s+/g, ' ').trim();
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function toolCallKey(call: FunctionCall): string {
  return `${call.name}:${stableStringify(call.args || {})}`;
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

function summarizeRequestedFunctionCalls(calls: FunctionCall[]): Array<Record<string, unknown>> {
  return calls.map((call) => ({
    name: call.name,
    args: call.args || {},
  }));
}

export {
  errorMessage,
  getBeijingTimeText,
  decodeHtmlEntities,
  isStickerMessage,
  extractImageUrls,
  oneLinePreview,
  stripCqCodes,
  stableStringify,
  toolCallKey,
  compactJson,
  previewText,
  summarizeRequestedFunctionCalls,
};
