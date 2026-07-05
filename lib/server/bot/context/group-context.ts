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
} from '../utils.js';
import { roleLabel } from '../permissions.js';
import { buildImageRefs } from '../tools/image.js';

// 群聊最近消息（旧到新）。文字上下文、图片上下文都基于同一份结果，避免重复查询/过滤。
function getRecentGroupMessages(event: OneBotEvent, cfg: BotConfig): Array<Record<string, any>> {
  if (!event.group_id) return [];
  const limit = Math.max(1, Math.min(50, Number(cfg.ai_group_context_messages || 20)));
  return messageStore.getMessages(limit + 12, null, event.group_id)
    .filter((m: Record<string, any>) => m.message_id !== event.message_id)
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
  cfg: BotConfig
): Promise<string> {
  if (!cfg.ai_group_context_include_quote) return '';
  const replyId = extractReplyMessageId(event.raw_message || '');
  if (!replyId || !client?.getMsg) return '';

  const result = await client.getMsg(replyId);
  if (!result || result.status !== 'ok' || !result.data) return '';

  const data = result.data;
  const senderName = formatSender(data.sender || {}, data.user_id);
  const raw = data.raw_message || String(data.message || '');
  const summary = summarizeRawMessage(raw, event.self_id);
  if (cfg.ai_filter_stickers !== false && ai.isStickerMessage(raw)) {
    return '';
  }

  const images = buildImageRefs(raw);
  const record = {
    message_id: replyId,
    speaker_qq: data.user_id ?? null,
    speaker_name: senderName,
    text: summary,
    ...(images.length ? { images } : {}),
  };
  return [
    'QUOTED_MESSAGE_JSON（当前消息直接引用的重点消息；speaker_* 是被引用消息的发言人）:',
    promptJson(record),
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
  recentMessages: Array<Record<string, any>> | null = null
): Promise<string> {
  if (!cfg.ai_group_context_enabled || !event.group_id) return '';
  const messages = recentMessages || getRecentGroupMessages(event, cfg);

  if (!messages.length) return '';

  const lines: string[] = [];
  let resolvedReplyCount = 0;
  for (const m of messages) {
    const raw = String(m.raw_message || '');
    lines.push(promptJson(buildContextMessageRecord(m, event.self_id, {
      time: formatTime(m.time),
      record_type: 'recent_group_message',
    })));

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
        lines.push(promptJson({
          record_type: 'quoted_message_for_recent_group_message',
          source_message_id: m.message_id ?? null,
          quoted_message_id: replyId,
          quoted_speaker_qq: result.data?.user_id ?? null,
          quoted_speaker_name: formatSender(result.data?.sender || {}, result.data?.user_id),
          quoted_text: summarizeRawMessage(quotedRaw, event.self_id).slice(0, 500),
          ...(quotedImages.length ? { quoted_images: quotedImages } : {}),
        }));
        resolvedReplyCount += 1;
      }
    }
  }

  return `RECENT_GROUP_MESSAGES_JSONL（按时间从旧到新；每行一条记录；speaker_qq/speaker_name 永远表示该行消息的发言人；images 是可按需读取的图片引用，不是已经看过的图片）:\n${lines.join('\n')}`;
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
  recentMessages: Array<Record<string, any>> | null = null
): Promise<string> {
  if (!event.group_id || !cfg.ai_group_context_enabled) return currentMsg;

  const sections = [
    [
      'GROUP_CONTEXT_RULES:',
      '- 只回答 CURRENT_MESSAGE_JSON 里的当前用户本条消息；它的 speaker_qq/speaker_name 是当前提问者',
      '- 如果存在 QUOTED_MESSAGE_JSON，它是当前消息直接引用的重点对象；优先围绕它回答',
      '- RECENT_GROUP_MESSAGES_JSONL 只是背景；每行的 speaker_qq/speaker_name 只属于该行消息，不要当成当前提问者',
      '- 只有 CURRENT_MESSAGE_JSON（当前消息自己的图）和 QUOTED_MESSAGE_JSON（当前消息明确引用/回复的那条消息的图）会自动附带真实的 CONTEXT_IMAGE 多模态图片；看图时用 CONTEXT_IMAGE 前的 message_id/speaker_name 对齐是哪条消息的图片',
      '- RECENT_GROUP_MESSAGES_JSONL 里某行如果带 images 字段，那只是图片的索引信息（image_key/message_id），你还没有真正看到这张图；只有当前问题确实需要看这张历史图片时，才调用 qq_read_image 工具（传 image_key 或 message_id+image_index）获取图片，不要凭 image_key 猜图片内容，也不要没事找事去调用',
      '- 重要：先判断 CURRENT_MESSAGE_JSON 这句话本身到底在问/要求什么（回答问题、搜索、点评、闲聊等），并把这件事作为回复的主体，直接开头切入，不要用介绍/描述某张图片开头',
      '- 除非当前消息或 QUOTED_MESSAGE_JSON 自带图片、或者你主动调用 qq_read_image 看过某张历史图片，否则不要凭空描述、总结、点评任何图片内容',
      '- 文本追问、继续介绍、解释上文、评价讨论、搜索查证时，只使用最近文字和引用回答问题本身，不要被无关图片带偏、也不要把图片内容当成额外话题主动展开',
      '- 即使 CURRENT_MESSAGE_JSON 或 QUOTED_MESSAGE_JSON 确实带了 CONTEXT_IMAGE，也要先判断当前这句话问的是不是跟这张图有关；如果当前问题明显在问别的事（引用只是顺手接了个话头，图片本身跟问题无关），就只回答那件事本身，不要因为看到了图片就多余地补充/点评图片内容',
      '- 如果 CURRENT_MESSAGE_JSON 和历史上下文冲突，以 CURRENT_MESSAGE_JSON 为准',
      '- 如果用户问"谁说的/他说的/那条/上面那条"，先用 message_id、speaker_qq、speaker_name 判断指向，不确定就说明不确定',
      '- RECENT_GROUP_MESSAGES_JSONL 只用来读懂当前这句话在说什么，不要主动引用、复述、点评里面别人说过的话；用户没让你翻旧账、没问"刚刚谁说了什么"这类问题时，回复里不要提到群里其他人之前说过什么',
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

  const quoted = await buildQuotedMessageContext(event, client, cfg);
  if (quoted) sections.push(quoted);

  const pending = buildPendingBotMentionContext(event, cfg);
  if (pending) sections.push(pending);

  const recent = await buildRecentGroupContext(event, client, cfg, recentMessages);
  if (recent) sections.push(recent);

  const currentImages = buildImageRefs(currentMsg);
  sections.push([
    'CURRENT_MESSAGE_JSON（最高优先级；speaker_* 是当前提问者）:',
    promptJson({
      message_id: event.message_id ?? null,
      speaker_qq: event.user_id ?? null,
      speaker_name: getEventSenderName(event),
      text: summarizeRawMessage(currentMsg, event.self_id),
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
