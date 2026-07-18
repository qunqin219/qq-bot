import type { BotConfig, ManagementPromptContext, OneBotClient, OneBotEvent } from '../types.js';

import * as ai from '../../ai.js';
import { messageStore } from '../../store/index.js';
import {
  extractReplyMessageId,
  extractAtUserIds,
  isBotMentionedRaw,
  isOnlyBotMentionMessage,
  formatSender,
  getEventSenderName,
  promptJson,
  summarizeRawMessage,
  isCommandContextMessage,
  formatTime,
  idsEqual,
} from '../utils.js';
import { roleLabel } from '../permissions.js';
import { buildImageRefs } from '../tools/image.js';
import type { ResolvedQuotedMessage } from './quote-chain.js';
import { resolveQuotedMessageChain } from './quote-chain.js';

const GROUP_MANAGEMENT_CONTEXT_TRIGGER = /(?:群成员|成员列表|禁言|解禁|解除禁言|全员禁言|群禁言|踢出|踢人|移出群|封禁|确认执行|确认禁言|确认解禁|确认踢出|确认全员禁言)/;

// 群聊最近消息（旧到新）。文字上下文、图片上下文都基于同一份结果，避免重复查询/过滤。
function getRecentGroupMessages(event: OneBotEvent, cfg: BotConfig): Array<Record<string, any>> {
  if (!event.group_id) return [];
  const limit = Math.max(1, Math.min(50, Number(cfg.ai_group_context_messages || 20)));
  return messageStore.getMessages(limit + 12, null, event.group_id)
    .filter((m: Record<string, any>) => !idsEqual(m.message_id, event.message_id))
    .filter((m: Record<string, any>) => !(cfg.ai_group_context_exclude_bot && m.user_id === event.self_id))
    .filter((m: Record<string, any>) => !(cfg.ai_filter_stickers !== false && ai.isStickerMessage(m.raw_message)))
    .filter((m: Record<string, any>) => !isCommandContextMessage(m.raw_message, cfg.command_prefix || '/'))
    .slice(0, limit)
    .reverse();
}

function buildContextMessageRecord(
  message: Record<string, any>,
  selfId: number | string | null | undefined,
  extra: Record<string, any> = {}
): Record<string, any> {
  const raw = String(message.raw_message || '');
  const images = buildImageRefs(raw);
  return {
    message_id: message.message_id ?? null,
    time: message.time || null,
    speaker_qq: message.user_id ?? null,
    speaker_name: message.group_name || message.nickname || String(message.user_id || '未知用户'),
    directed_to_bot: isBotMentionedRaw(raw, selfId),
    text: summarizeRawMessage(raw, selfId).slice(0, 500),
    ...(images.length ? { images } : {}),
    ...extra,
  };
}

async function buildQuotedMessageContext(
  event: OneBotEvent,
  client: OneBotClient,
  cfg: BotConfig,
  quotedMessageChain: ResolvedQuotedMessage[] | null = null
): Promise<string> {
  if (!cfg.ai_group_context_include_quote) return '';
  const records: Array<Record<string, any>> = [];
  const chain = quotedMessageChain || await resolveQuotedMessageChain(event.raw_message || '', client, 3);
  for (const quoted of chain) {
    const raw = quoted.raw_message;
    if (!(cfg.ai_filter_stickers !== false && ai.isStickerMessage(raw))) {
      const images = buildImageRefs(raw);
      records.push({
        record_type: 'quoted_message',
        quote_depth: quoted.quote_depth,
        message_id: quoted.message_id,
        speaker_qq: quoted.user_id,
        speaker_name: formatSender(quoted.sender, quoted.user_id),
        text: summarizeRawMessage(raw, event.self_id),
        reply_to_message_id: quoted.reply_to_message_id,
        ...(images.length ? { images } : {}),
      });
    }
  }
  if (!records.length) return '';
  return [
    'QUOTED_MESSAGE_CHAIN_JSONL（引用关系链；quote_depth=1 是当前消息直接引用的对象，数字越大表示继续向上追溯的被引用消息）:',
    ...records.map((record) => promptJson(record)),
  ].join('\n');
}

async function buildMentionedMembersContext(event: OneBotEvent, client: OneBotClient): Promise<string> {
  if (!event.group_id) return '';
  const selfId = Number(event.self_id || 0);
  const ids = extractAtUserIds(event.raw_message || '')
    .filter((id: number) => id && id !== selfId)
    .slice(0, 5);
  if (!ids.length) return '';

  const lines: string[] = [];
  for (const id of ids) {
    const result = client?.getGroupMemberInfo
      ? await client.getGroupMemberInfo(event.group_id, id, true)
      : null;
    if (result?.status === 'ok' && result.data) {
      const name = formatSender(result.data.sender || result.data, id);
      lines.push(promptJson({
        member_qq: id,
        member_name: name,
        role: roleLabel(result.data.role || 'unknown'),
      }));
    } else {
      lines.push(promptJson({ member_qq: id }));
    }
  }
  return `MENTIONED_MEMBERS_JSONL（当前消息额外 @ 到的群成员，通常是用户要求操作/询问的对象）:\n${lines.join('\n')}`;
}

async function buildRecentGroupContext(
  event: OneBotEvent,
  client: OneBotClient,
  cfg: BotConfig,
  recentMessages: Array<Record<string, any>> | null = null,
  conversationHistory: Array<Record<string, any>> = []
): Promise<string> {
  if (!cfg.ai_group_context_enabled || !event.group_id) return '';
  const messages = recentMessages || getRecentGroupMessages(event, cfg);
  const hasBotHistory = conversationHistory.some((item) => (
    item?.role === 'model' && String(item.text || '').trim()
  ));
  if (!messages.length && !hasBotHistory) return '';

  const timeline: Array<{ timestamp: number; sequence: number; record: Record<string, any> }> = [];
  let resolvedReplyCount = 0;
  let sequence = 0;
  for (const m of messages) {
    const raw = String(m.raw_message || '');
    timeline.push({
      timestamp: Date.parse(String(m.time || '')) || 0,
      sequence: sequence += 1,
      record: buildContextMessageRecord(m, event.self_id, {
        time: formatTime(m.time),
        record_type: 'group_message',
      }),
    });

    // 历史聊天里有人"引用了一条图片消息"时，当前消息本身只有 [CQ:reply]，图片在被引用消息里。
    // 这里把被引用消息做成文字和图片引用摘要；实际图片本体会随群上下文一起作为多模态 parts 提供。
    const replyId = extractReplyMessageId(raw);
    if (replyId && client?.getMsg && cfg.ai_group_context_include_quote && resolvedReplyCount < 5) {
      const result = await client.getMsg(replyId);
      const quotedRaw = result?.status === 'ok'
        ? (result.data?.raw_message || String(result.data?.message || ''))
        : '';
      if (quotedRaw && !(cfg.ai_filter_stickers !== false && ai.isStickerMessage(quotedRaw))) {
        const quotedImages = buildImageRefs(quotedRaw);
        timeline.push({
          timestamp: (Date.parse(String(m.time || '')) || 0) + 0.1,
          sequence: sequence += 1,
          record: {
            record_type: 'quoted_message_for_group_message',
            source_message_id: m.message_id ?? null,
            quoted_message_id: replyId,
            quoted_speaker_qq: result.data?.user_id ?? null,
            quoted_speaker_name: formatSender(result.data?.sender || {}, result.data?.user_id),
            quoted_text: summarizeRawMessage(quotedRaw, event.self_id).slice(0, 500),
            ...(quotedImages.length ? { quoted_images: quotedImages } : {}),
          },
        });
        resolvedReplyCount += 1;
      }
    }
  }

  const oldestGroupTimestamp = timeline.reduce((oldest, item) => (
    item.timestamp > 0 && (oldest === 0 || item.timestamp < oldest) ? item.timestamp : oldest
  ), 0);
  const botHistory = conversationHistory
    .filter((item) => item?.role === 'model' && String(item.text || '').trim())
    .map((item) => ({ item, timestamp: Date.parse(String(item.time || '')) || 0 }));
  const latestBotBeforeWindow = oldestGroupTimestamp
    ? [...botHistory].reverse().find(({ timestamp }) => timestamp > 0 && timestamp < oldestGroupTimestamp)
    : null;
  const botHistoryForTimeline = oldestGroupTimestamp
    ? botHistory.filter(({ timestamp }) => timestamp >= oldestGroupTimestamp)
    : botHistory.slice(-10);
  if (latestBotBeforeWindow) botHistoryForTimeline.unshift(latestBotBeforeWindow);

  for (const { item, timestamp } of botHistoryForTimeline) {
    timeline.push({
      timestamp,
      sequence: sequence += 1,
      record: {
        record_type: 'bot_reply',
        message_id: null,
        time: formatTime(item.time),
        speaker_qq: event.self_id ?? null,
        speaker_name: 'Bot',
        directed_to_bot: false,
        text: String(item.text).slice(0, 500),
      },
    });
  }

  const lines = timeline
    .sort((left, right) => left.timestamp - right.timestamp || left.sequence - right.sequence)
    .map((item) => promptJson(item.record));
  return `RECENT_GROUP_EVENTS_JSONL（统一事件时间线，严格按实际时间从旧到新；包含群成员消息和 Bot 历史回复；speaker_* 永远只属于该行；images 只是可按需读取的图片引用）:\n${lines.join('\n')}`;
}

function findRecentUnansweredBotMention(event: OneBotEvent, cfg: BotConfig): Record<string, any> | null {
  if (!event.group_id || !event.self_id) return null;
  const candidates = messageStore.getMessages(80, null, event.group_id)
    .filter((m: Record<string, any>) => m.message_id !== event.message_id)
    .filter((m: Record<string, any>) => !(cfg.ai_filter_stickers !== false && ai.isStickerMessage(m.raw_message)))
    .filter((m: Record<string, any>) => !isCommandContextMessage(m.raw_message, cfg.command_prefix || '/'));

  let seenBotMessage = false;
  let fallback = null;
  for (const m of candidates) {
    if (m.user_id === event.self_id) {
      seenBotMessage = true;
      continue;
    }
    const raw = String(m.raw_message || '');
    if (!isBotMentionedRaw(raw, event.self_id) || isOnlyBotMentionMessage(raw, event.self_id)) continue;
    if (seenBotMessage) continue;
    if (m.user_id === event.user_id) return m;
    if (!fallback) fallback = m;
  }
  return fallback;
}

function buildPendingBotMentionContext(event: OneBotEvent, cfg: BotConfig): string {
  if (!isOnlyBotMentionMessage(event.raw_message || '', event.self_id)) return '';
  const pending = findRecentUnansweredBotMention(event, cfg);
  if (!pending) return '';
  const record = buildContextMessageRecord(pending, event.self_id, {
    time: formatTime(pending.time),
  });
  return [
    'PENDING_UNANSWERED_BOT_MENTION_JSON（当前用户本次只 @Bot 且没有新问题时，用它判断是否在催促上一次未回答请求）:',
    promptJson(record),
  ].join('\n');
}

async function buildGroupAwarePrompt(
  event: OneBotEvent,
  client: OneBotClient,
  cfg: BotConfig,
  currentMsg: string,
  managementContext: ManagementPromptContext | null = null,
  recentMessages: Array<Record<string, any>> | null = null,
  conversationHistory: Array<Record<string, any>> = [],
  quotedMessageChain: ResolvedQuotedMessage[] | null = null
): Promise<string> {
  if (!event.group_id || !cfg.ai_group_context_enabled) return currentMsg;

  const sections = [
    [
      'GROUP_CONTEXT_SCHEMA:',
      '- CURRENT_MESSAGE_JSON 是本次触发事件；speaker_* 表示当前触发者',
      '- QUOTED_MESSAGE_CHAIN_JSONL 是当前消息的显式引用链；quote_depth=1 表示直接引用对象',
      '- CURRENT_MESSAGE_JSON.interaction_intent=answer_quoted_message 表示直接引用对象就是交给 Bot 处理的请求',
      '- RECENT_GROUP_EVENTS_JSONL 是按真实时间排列的背景事件；每行的 speaker_* 只属于该行',
      '- CONTEXT_IMAGE 是已经随请求提供的真实图片，并与它前面的 message_id 对应',
      '- RECENT_GROUP_EVENTS_JSONL 中的 images 只是图片索引；需要其内容时用 image_key 或 message_id 调用 qq_read_image',
      '- 指代无法从当前消息、显式引用和事件时间线中可靠确定时，说明不确定或请求澄清',
      '- 需要让 QQ 客户端引用某条消息时，最终回复第一行使用“引用消息ID：数字”；否则直接输出正文',
    ].join('\n'),
  ];

  const currentText = ai.stripCqCodes(currentMsg).trim();
  if (managementContext && GROUP_MANAGEMENT_CONTEXT_TRIGGER.test(currentText)) {
    sections.push([
      'GROUP_MANAGEMENT_CONTEXT_JSON:',
      promptJson({
        requester_qq: event.user_id ?? null,
        requester_name: getEventSenderName(event),
        requester_is_configured_admin: managementContext.requesterIsAdmin,
        bot_group_role: roleLabel(managementContext.botRole),
        management_tools_available: managementContext.toolsEnabled,
        member_list_tool_available: managementContext.memberListEnabled,
      }),
      '群管理写操作只有当前消息明确确认时才执行；目标不明确时先澄清或查询成员，不能猜 QQ 号。',
    ].join('\n'));
  }

  const mentionedMembers = await buildMentionedMembersContext(event, client);
  if (mentionedMembers) sections.push(mentionedMembers);

  const quoted = await buildQuotedMessageContext(event, client, cfg, quotedMessageChain);
  if (quoted) sections.push(quoted);

  const pending = buildPendingBotMentionContext(event, cfg);
  if (pending) sections.push(pending);

  const recent = await buildRecentGroupContext(event, client, cfg, recentMessages, conversationHistory);
  if (recent) sections.push(recent);

  const currentImages = buildImageRefs(currentMsg);
  const replyToMessageId = extractReplyMessageId(currentMsg);
  const hasCurrentNaturalLanguage = Boolean(ai.stripCqCodes(currentMsg).trim());
  const answerQuotedMessage = Boolean(replyToMessageId && !hasCurrentNaturalLanguage && currentImages.length === 0);
  sections.push([
    'CURRENT_MESSAGE_JSON（本次触发事件；speaker_* 是当前提问者）:',
    promptJson({
      record_type: 'focus_event',
      message_id: event.message_id ?? null,
      speaker_qq: event.user_id ?? null,
      speaker_name: getEventSenderName(event),
      text: summarizeRawMessage(currentMsg, event.self_id),
      reply_to_message_id: replyToMessageId,
      ...(answerQuotedMessage ? { interaction_intent: 'answer_quoted_message' } : {}),
      ...(currentImages.length ? { images: currentImages } : {}),
    }),
  ].join('\n'));
  return sections.join('\n\n');
}

export {
  getRecentGroupMessages,
  buildGroupAwarePrompt,
};
