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
      'GROUP_CONTEXT_RULES:',
      '- CURRENT_MESSAGE_JSON 描述本次触发事件（focus event）；它的 speaker_qq/speaker_name 是当前触发者',
      '- 如果存在 QUOTED_MESSAGE_CHAIN_JSONL，quote_depth=1 是当前消息明确指定的直接对象，优先级高于普通历史；后续深度用于消解“他们/这个/那个”等引用对象',
      '- 如果 CURRENT_MESSAGE_JSON.interaction_intent 是 answer_quoted_message，直接回答 quote_depth=1 中的问题或请求；不要只回复“在呢/怎么了”，也不要把纯 @ 当成问题主体',
      '- RECENT_GROUP_EVENTS_JSONL 是唯一的群聊历史时间线；每行的 speaker_qq/speaker_name 只属于该行，不要把任意历史发言人当成当前触发者',
      '- 只有 CURRENT_MESSAGE_JSON（当前消息自己的图）和 QUOTED_MESSAGE_CHAIN_JSONL（当前消息明确引用链里的图片）会自动附带真实的 CONTEXT_IMAGE 多模态图片；看图时用 CONTEXT_IMAGE 前的 message_id/speaker_name 对齐是哪条消息的图片',
      '- RECENT_GROUP_EVENTS_JSONL 里某行如果带 images 字段，那只是图片的索引信息（image_key/message_id），你还没有真正看到这张图；只有当前问题确实需要看这张历史图片时，才调用 qq_read_image 工具（传 image_key 或 message_id+image_index）获取图片，不要凭 image_key 猜图片内容，也不要没事找事去调用',
      '- 重要：根据 CURRENT_MESSAGE_JSON 的消息结构、显式引用链和统一事件时间线共同确定本次任务（回答问题、搜索、点评、闲聊等），并把这件事作为回复主体，直接开头切入',
      '- 除非当前消息或 QUOTED_MESSAGE_CHAIN_JSONL 自带图片、或者你主动调用 qq_read_image 看过某张历史图片，否则不要凭空描述、总结、点评任何图片内容',
      '- 文本追问、继续介绍、解释上文、评价讨论、搜索查证时，按 RECENT_GROUP_EVENTS_JSONL 的真实时间顺序和显式引用关系判断对象，不要把更早的 Bot 回复误当成刚刚发生的话题',
      '- 即使 CURRENT_MESSAGE_JSON 或 QUOTED_MESSAGE_CHAIN_JSONL 确实带了 CONTEXT_IMAGE，也要先判断当前这句话问的是不是跟这张图有关；如果当前问题明显在问别的事（引用只是顺手接了个话头，图片本身跟问题无关），就只回答那件事本身，不要因为看到了图片就多余地补充/点评图片内容',
      '- 如果 CURRENT_MESSAGE_JSON 和历史上下文冲突，以 CURRENT_MESSAGE_JSON 为准',
      '- 如果用户问"谁说的/他说的/那条/上面那条"，先用 message_id、speaker_qq、speaker_name 判断指向，不确定就说明不确定',
      '- RECENT_GROUP_EVENTS_JSONL 只用来读懂当前请求，不要无关地翻旧账；但当前消息明确引用、追问或要求评价群内讨论时，应当使用对应的最近事件回答',
      '- 普通闲聊、接话、评价上文，优先基于当前消息、引用消息和最近上下文直接回答',
      '- 需要外部事实、最新消息、网页内容、产品/模型/公司/事件资料、价格、版本或状态时，联网工具可用再查证',
      '- 只有用户明确要求引用/回复/评价某条消息，或明显用"他/她/那条/上面那条"指向某条上文时，才在最终回复第一行输出"引用消息ID：数字"',
      '- 普通追问、继续、还有吗、闲聊时不要输出引用消息ID',
    ].join('\n'),
  ];

  if (managementContext) {
    sections.push(
      `当前触发用户：${getEventSenderName(event)}，QQ=${event.user_id}，` +
      `${managementContext.requesterIsAdmin ? '是' : '不是'} bot 配置管理员。` +
      `我在本群的身份是${roleLabel(managementContext.botRole)}。` +
      `群管理工具${managementContext.toolsEnabled ? '可用' : '不可用'}。` +
      `群成员列表工具${managementContext.memberListEnabled ? '可用' : '不可用'}。` +
      '如果需要通过昵称、群名片或模糊称呼查 QQ 号，可以调用 qq_get_group_members；需要全部成员时不传 keyword，需要筛选时传 keyword。' +
      '如果管理员说"开启/关闭全员禁言/群禁言"，调用 qq_set_group_whole_ban。' +
	      '如果管理员说"把群里所有人都禁言/给所有人上X分钟"，调用 qq_mute_all_manageable_members，不要只查成员列表。' +
	      '如果管理员说"把所有禁言都解开/所有人解禁"，调用 qq_unmute_all_manageable_members。' +
	      '只有用户明确要求禁言、解除禁言、踢出成员等群管理动作，并且当前消息包含"确认执行/确认禁言/确认解禁/确认踢出/确认全员禁言"等确认语时才调用管理工具；否则先要求管理员确认，不要调用操作工具。不要因为普通争吵或玩笑自动管理。' +
      '如果当前消息额外 @ 了某个群成员，并且管理员要求禁言/解禁/踢出/封禁，优先把这个被 @ 的 QQ 作为 target_user_id。' +
      '调用工具时必须使用上下文里明确给出的 QQ 号作为 target_user_id，不要猜 QQ 号。'
    );
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
    // 长对话里模型很容易被自己前几轮里写过的长回复带节奏，即使系统提示词要求简洁也会越写越长；
    // 这条特意放在整个 prompt 最后、紧贴着当前问题，靠"最近位置"的权重去对抗这种惯性漂移，
    // 而不是只在最前面的系统提示词里说一次。注意不要矫枉过正——真正需要展开的问题还是可以写长。
    '不管上文（包括你自己之前的回复）多长，这次的长度只由当前这句话本身的难度决定：简单的问题就简短回答，不要被之前更长的回复带节奏；问题本身复杂、或用户明确要详细说明时，照样可以写够长度，不用为了显得简洁而故意省略该讲的内容。',
  ].join('\n'));
  return sections.join('\n\n');
}

export {
  getRecentGroupMessages,
  buildGroupAwarePrompt,
};
