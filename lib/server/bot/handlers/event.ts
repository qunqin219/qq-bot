import type { OneBotClient, OneBotEvent } from '../types.js';

import { loadConfig } from '../../config.js';
import { messageStore, conversationStore } from '../../store/index.js';
import * as ai from '../../ai.js';
import * as imageCache from '../../image-cache.js';
import { previewText, getEventSenderName, summarizeRawMessage } from '../utils.js';
import { isConfiguredAdmin, isGroupWithinConfiguredScope, shouldPersistIncomingMessage } from '../permissions.js';
import { withConversationLock } from '../conversation-lock.js';
import { handleAiTurn } from './ai-turn.js';
import { handleCommand } from './command.js';

/**
 * 处理 OneBot 事件（仅处理消息事件）。
 */
async function handleEvent(event: OneBotEvent, client: OneBotClient): Promise<void> {
  if (event.post_type !== 'message') return;

  const cfg = loadConfig();
  const userId = event.user_id || 0;
  // raw_message 为纯文本，message 可能为数组格式
  let msg = event.raw_message || '';
  if (!msg) {
    const raw = event.message;
    if (typeof raw === 'string') {
      msg = raw;
    } else {
      msg = String(raw || '');
    }
  }
  const msgType = event.message_type || '';
  const groupId = event.group_id;

  console.log(
    `[BotCore] 收到消息 type=${msgType || '-'} group=${groupId || '-'} user=${userId || '-'} ` +
    `message_id=${event.message_id || '-'} sender=${previewText(getEventSenderName(event), 80) || '-'} ` +
    `msg=${previewText(summarizeRawMessage(msg, event.self_id), 220) || '-'}`
  );

  const selfId = String(event.self_id || '');
  const isMentioned = groupId ? msg.includes(`[CQ:at,qq=${selfId}]`) : false;
  const prefix = cfg.command_prefix || '/';
  const isCommand = msg.startsWith(prefix);
  const isAdmin = isConfiguredAdmin(cfg, userId);
  const withinConfiguredScope = isGroupWithinConfiguredScope(cfg, groupId);

  if (!withinConfiguredScope) return;

  // 忽略自身消息，也避免把 bot 自己的输出再次落盘成用户消息。
  if (Number(userId) === Number(event.self_id)) return;

  if (shouldPersistIncomingMessage(event, cfg, isAdmin)) {
    // 存储消息（供面板查看和允许范围内的群聊上下文检索）
    messageStore.addMessage(event as any);

    // QQ 图片 URL 带临时 rkey，过期后无法下载；仅对允许范围内消息做后台缓存。
    if (/\[CQ:image,/.test(msg)) {
      imageCache.cacheImagesFromMessage(msg, {
        message_id: event.message_id,
        group_id: event.group_id || null,
        user_id: event.user_id || null,
        message_type: event.message_type || null,
      }, {
        ignoreStickers: cfg.ai_filter_stickers !== false,
      }).catch((e: unknown) => {
        console.warn('[ImageCache] 后台缓存任务异常:', e instanceof Error ? e.message : String(e));
      });
    }
  }

  // 管理员始终可用；非管理员只在"群聊 + @bot + 面板开关开启 + 非命令"时允许触发 AI。
  const allowGroupMentionFromNonAdmin =
    groupId &&
    isMentioned &&
    !isCommand &&
    cfg.ai_allow_group_mention_from_non_admin === true;
  if (!isAdmin && !allowGroupMentionFromNonAdmin) return;

  // 命令处理（非管理员命令在前面的权限检查中已经被拦截）
  if (isCommand) {
    await handleCommand(msg.slice(prefix.length), event, client, cfg);
    return;
  }

  // AI 自动回复
  // 群消息：只有 @bot 才进入；私聊：直接进入。
  if (groupId && !isMentioned) return;

  // AI 未启用或未配置 API Key 时直接不回复。
  if (!ai.isConfigured(cfg)) return;

  // 只有表情包/动画表情时默认不触发 AI，避免把群聊斗图当成问题处理。
  if (cfg.ai_filter_stickers !== false && ai.isStickerMessage(msg) && !ai.stripCqCodes(msg)) return;

  // 清洗文本用于本地 AI 历史；当前请求仍会把原始 CQ 码交给 ai.ts，以便提取图片。
  let cleanMsg = summarizeRawMessage(msg, event.self_id);
  if (!cleanMsg) cleanMsg = /\[CQ:image,/.test(msg) ? '[图片]' : '你好';

  // 同一会话（同一个群/同一个私聊）内，AI 的"读历史 -> 请求模型 -> 写历史"必须串行执行；
  // 否则两条近乎同时到达的消息会并发地基于同一份旧历史发起请求，互相看不到对方那一轮回复。
  const lockKey = conversationStore.getConversationKey(event);
  await withConversationLock(lockKey, () => handleAiTurn(event, client, cfg, {
    userId,
    msgType,
    groupId,
    isAdmin,
    cleanMsg,
  }));
}

export { handleEvent };
