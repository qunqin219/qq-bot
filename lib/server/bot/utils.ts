import type { BotConfig, OneBotEvent, OneBotResult, OneBotSender } from './types.js';

import * as ai from '../ai.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function previewText(value: unknown, maxLength = 180): string {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function summarizeToolResult(result: Record<string, any> | null | undefined): Record<string, any> {
  if (!result || typeof result !== 'object') return { ok: false, message: String(result || '') };
  return {
    ok: result.ok,
    action: result.action,
    message: result.message,
    message_id: result.message_id,
    image_key: result.image_key,
    image_index: result.image_index,
    speaker_qq: result.speaker_qq,
    speaker_name: result.speaker_name,
    target_count: result.target_count,
    success_count: result.success_count,
    failed_count: result.failed_count,
    returned_count: result.returned_count,
  };
}

function summarizeOneBotResult(result: OneBotResult | null | undefined): Record<string, any> {
  if (!result || typeof result !== 'object') return { status: 'unknown' };
  return {
    status: result.status || 'unknown',
    wording: result.wording,
    msg: result.msg,
  };
}

function buildEnabledToolAuditList(cfg: BotConfig, functionDeclarations: Array<Record<string, any>> = []): string {
  const names = functionDeclarations
    .map((item) => item?.name)
    .filter(Boolean);
  if (cfg.ai_google_search_enabled === true) names.push('googleSearch');
  if (cfg.ai_url_context_enabled === true) names.push('urlContext');
  if (cfg.ai_provider === 'openai' && cfg.ai_web_search_enabled === true) names.push('web_search');
  if (cfg.ai_provider === 'openai' && cfg.ai_web_fetch_enabled === true) names.push('web_fetch');
  const uniqueNames = [...new Set(names)];
  return uniqueNames.length ? uniqueNames.join(',') : '-';
}

function extractReplyMessageId(msg: unknown): string | null {
  const match = String(msg || '').match(/\[CQ:reply,id=([^\],]+)[^\]]*\]/);
  return match ? match[1] : null;
}

function extractAtUserIds(msg: unknown): number[] {
  const ids: number[] = [];
  const re = /\[CQ:at,qq=([^,\]]+)[^\]]*\]/g;
  let match;
  while ((match = re.exec(String(msg || ''))) !== null) {
    const id = Number(match[1]);
    if (Number.isFinite(id)) ids.push(id);
  }
  return [...new Set(ids)];
}

function annotateAtMentions(raw: unknown, selfId: number | string | null = null): string {
  return String(raw || '').replace(/\[CQ:at,qq=([^,\]]+)[^\]]*\]/g, (_, qq) => {
    const id = Number(qq);
    if (selfId && id === Number(selfId)) return '@Bot';
    return `@QQ=${qq}`;
  });
}

function isBotMentionedRaw(raw: unknown, selfId: number | string | null | undefined): boolean {
  return Boolean(selfId) && String(raw || '').includes(`[CQ:at,qq=${selfId}]`);
}

function isOnlyBotMentionMessage(raw: unknown, selfId: number | string | null | undefined): boolean {
  if (!isBotMentionedRaw(raw, selfId)) return false;
  // 引用一条消息再 @Bot 是有明确语义的“请处理这条引用”，不能当成空唤醒。
  if (extractReplyMessageId(raw)) return false;
  const text = ai.stripCqCodes(raw).trim();
  const hasMedia = /\[CQ:(image|record|video|file),/.test(String(raw || ''));
  const atIds = extractAtUserIds(raw);
  return !text && !hasMedia && atIds.length > 0 && atIds.every((id) => id === Number(selfId));
}

function formatSender(sender: OneBotSender = {}, fallbackUserId: number | string | null = ''): string | number {
  return sender.card || sender.nickname || sender.user_id || fallbackUserId || '未知用户';
}

function getEventSenderName(event: OneBotEvent): string | number {
  const sender = event?.sender || {};
  return formatSender(sender, event?.user_id || '未知用户');
}

function promptJson(value: Record<string, any>): string {
  return JSON.stringify(value);
}

function summarizeRawMessage(raw: unknown, selfId: number | string | null = null): string {
  const annotated = annotateAtMentions(raw, selfId);
  const text = ai.stripCqCodes(annotated);
  const tags: string[] = [];
  if (/\[CQ:image,/.test(String(raw || ''))) tags.push('[图片]');
  if (/\[CQ:record,/.test(String(raw || ''))) tags.push('[语音]');
  if (/\[CQ:video,/.test(String(raw || ''))) tags.push('[视频]');
  if (/\[CQ:file,/.test(String(raw || ''))) tags.push('[文件]');
  return [text, ...tags].filter(Boolean).join(' ').trim() || '[非文本消息]';
}

function isCommandContextMessage(raw: unknown, prefix = '/'): boolean {
  const text = ai.stripCqCodes(raw).trim();
  if (!text) return false;
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const commandRe = new RegExp(`^${escapedPrefix}(ping|status|help|clearcontext|clearctx)(\\s|$)`, 'i');
  return (
    commandRe.test(text) ||
    /^命令列表[:：]/.test(text) ||
    /\/clearcontext\s*-\s*清空当前/.test(text) ||
    /\/ping\s*-\s*测试/.test(text)
  );
}

function formatTime(iso: unknown): string {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso as any));
  } catch {
    return '';
  }
}

function messageTime(message: Record<string, any>): string | null {
  return message.time || message.created_at || null;
}

function getCurrentHourText() {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}年${get('month')}月${get('day')}日的${get('hour')}点`;
}

function idsEqual(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return false;
  if (String(a) === String(b)) return true;
  const left = Number(a);
  const right = Number(b);
  return Number.isFinite(left) && Number.isFinite(right) && left === right;
}

function senderNameForMessage(message: Record<string, any>): string | number {
  return message.group_name || message.nickname || formatSender(message.sender || {}, message.user_id);
}

function geminiTextContent(role: 'user' | 'model', text: unknown): Record<string, any> {
  return {
    role,
    parts: [{ text: String(text || '') }],
  };
}

export {
  errorMessage,
  compactJson,
  previewText,
  summarizeToolResult,
  summarizeOneBotResult,
  buildEnabledToolAuditList,
  extractReplyMessageId,
  extractAtUserIds,
  annotateAtMentions,
  isBotMentionedRaw,
  isOnlyBotMentionMessage,
  formatSender,
  getEventSenderName,
  promptJson,
  summarizeRawMessage,
  isCommandContextMessage,
  formatTime,
  messageTime,
  getCurrentHourText,
  idsEqual,
  senderNameForMessage,
  geminiTextContent,
};
