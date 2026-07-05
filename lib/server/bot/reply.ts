import type { BotConfig, OneBotEvent } from './types.js';

import * as ai from '../ai.js';
import { messageStore } from '../store/index.js';
import { extractReplyMessageId } from './utils.js';

function parseAiReplyDirective(text: unknown): { text: string; replyMessageId: number | null } {
  const raw = String(text || '').trim();
  const match = raw.match(/^引用消息ID[:：]\s*(\d+)\s*\n+/);
  if (!match) return { text: raw, replyMessageId: null };
  return {
    replyMessageId: Number(match[1]),
    text: raw.slice(match[0].length).trim(),
  };
}

function isKnownGroupMessageId(groupId: number | string | null | undefined, messageId: number | string | null | undefined): boolean {
  if (!groupId || !messageId) return false;
  return messageStore.getMessages(120, null, groupId)
    .some((m: Record<string, any>) => Number(m.message_id) === Number(messageId));
}

function userExplicitlyAskedForQuote(raw: unknown): boolean {
  const text = ai.stripCqCodes(raw).trim();
  return /引用|回复|回一下|评价一下|点评一下|这条|那条|上面那/.test(text);
}

function userLikelyTargetsContextMessage(raw: unknown): boolean {
  const text = ai.stripCqCodes(raw).trim();
  if (userExplicitlyAskedForQuote(raw)) return true;
  return /\bta\b|他|她|它|那个人|那位|刚才那/.test(text) && !/还有吗|继续说|展开|忘记/.test(text);
}

function buildGroupReplyMessage(
  event: OneBotEvent,
  cfg: BotConfig,
  text: string,
  aiSelectedMessageId: number | string | null = null
): string {
  if (!event?.group_id || cfg.ai_group_reply_quote_enabled !== true) return text;
  const currentMessageId = event.message_id;
  if (!currentMessageId) return text;

  const quotedMessageId = cfg.ai_group_reply_quote_prefer_quoted !== false
    ? extractReplyMessageId(event.raw_message || '')
    : null;
  const modelSelectedId = (
    userLikelyTargetsContextMessage(event.raw_message || '') &&
    isKnownGroupMessageId(event.group_id, aiSelectedMessageId)
  )
    ? aiSelectedMessageId
    : null;

  // 用户明确要求引用/回复某条上文时，如果模型没选出 ID，不要退回引用当前 @Bot 消息。
  // 否则看起来像"引用错了"。这种情况直接普通回复更安全。
  if (!modelSelectedId && !quotedMessageId && userExplicitlyAskedForQuote(event.raw_message || '')) {
    console.warn('[BotCore] 用户要求引用，但模型没有选择有效消息ID，改为普通回复');
    return text;
  }

  const targetMessageId = modelSelectedId || quotedMessageId;
  if (!targetMessageId) return text;
  console.log(`[BotCore] 群聊回复引用 message_id=${targetMessageId}`);

  // 只发送 reply CQ，不追加 [CQ:at]，避免 QQ 里产生很吵的 @ 提醒。
  return `[CQ:reply,id=${targetMessageId}]${text}`;
}

export {
  parseAiReplyDirective,
  isKnownGroupMessageId,
  userExplicitlyAskedForQuote,
  userLikelyTargetsContextMessage,
  buildGroupReplyMessage,
};
