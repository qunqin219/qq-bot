import type { BotConfig, GroupManagementContext, OneBotClient, OneBotEvent, ToolArgs } from '../types.js';

import fs from 'fs';
import { INTERNAL_INLINE_PARTS_FIELD, IMAGE_TOOL_SEARCH_LIMIT, MAX_GROUP_CONTEXT_INLINE_IMAGES } from '../types.js';
import * as imageCache from '../../image-cache.js';
import { messageStore } from '../../store/index.js';
import {
  idsEqual,
  senderNameForMessage,
  summarizeRawMessage,
  promptJson,
  formatTime,
  messageTime,
} from '../utils.js';
import { resolveQuotedMessageChain } from '../context/quote-chain.js';
import type { ResolvedQuotedMessage } from '../context/quote-chain.js';

function buildImageRefs(raw: unknown): Array<Record<string, any>> {
  return imageCache.extractImageRecords(raw, {
    ignoreStickers: true,
    maxImages: 5,
  }).map((record: Record<string, any>, index: number) => ({
    image_key: imageCache.cacheKeyForRecord(record as any),
    image_index: index + 1,
    file: record.file || null,
    summary: record.summary || null,
    file_size: record.file_size || null,
  }));
}

async function imageRecordToInlinePart(
  record: Record<string, any>,
  meta: Record<string, any>
): Promise<{ ok: true; part: Record<string, any>; entry: Record<string, any> } | { ok: false; message: string }> {
  const entry = imageCache.getCachedImage(record as any) || await imageCache.cacheImageRecord(record as any, {
    message_id: meta.message_id || null,
    group_id: meta.group_id || null,
    user_id: meta.user_id || null,
    message_type: meta.message_type || null,
  });
  if (!entry?.file_path || !fs.existsSync(entry.file_path)) {
    return { ok: false, message: '图片还没有缓存成功，且临时 URL 可能已经不可用' };
  }
  const size = Number(entry.size || fs.statSync(entry.file_path).size || 0);
  const maxBytes = Number(imageCache.MAX_IMAGE_BYTES || 8 * 1024 * 1024);
  if (size > maxBytes) return { ok: false, message: `图片过大：${size} bytes` };
  const buf = fs.readFileSync(entry.file_path);
  return {
    ok: true,
    entry,
    part: {
      inline_data: {
        mime_type: entry.mime_type || 'image/jpeg',
        data: buf.toString('base64'),
      },
    },
  };
}

function imageToolCandidateMessages(event: OneBotEvent): Array<Record<string, any>> {
  const seen = new Set<string>();
  const candidates = [event, ...messageStore.getMessages(IMAGE_TOOL_SEARCH_LIMIT, null, event.group_id || null)];
  return candidates.filter((message) => {
    if (!message) return false;
    if (message.group_id && event.group_id && !idsEqual(message.group_id, event.group_id)) return false;
    const key = String(message.message_id || `${message.user_id || ''}:${messageTime(message) || ''}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findImageForTool(
  args: ToolArgs,
  event: OneBotEvent,
  cfg: BotConfig
): Record<string, any> | null {
  const wantedKey = String(args?.image_key || '').trim();
  const wantedMessageId = args?.message_id ?? null;
  const wantedIndex = Math.max(1, Number(args?.image_index || 1));
  const allowDefaultLatest = !wantedKey && !wantedMessageId;

  for (const message of imageToolCandidateMessages(event)) {
    if (wantedMessageId && !idsEqual(message.message_id, wantedMessageId)) continue;
    const raw = String(message.raw_message || message.message || '');
    const records = imageCache.extractImageRecords(raw, {
      ignoreStickers: cfg.ai_filter_stickers !== false,
      maxImages: 5,
    });
    for (const [index, record] of records.entries()) {
      const imageKey = imageCache.cacheKeyForRecord(record);
      const imageIndex = index + 1;
      if (wantedKey && imageKey !== wantedKey) continue;
      if (!wantedKey && wantedMessageId && imageIndex !== wantedIndex) continue;
      if (wantedKey || wantedMessageId || allowDefaultLatest) {
        return { message, record, imageKey, imageIndex };
      }
    }
  }

  return null;
}

async function executeReadImageTool(
  args: ToolArgs,
  context: GroupManagementContext
): Promise<Record<string, any>> {
  const { event, cfg } = context;
  if (!event.group_id) {
    return { ok: false, message: 'qq_read_image 只能读取当前群聊上下文里的图片' };
  }
  const found = findImageForTool(args, event, cfg);
  if (!found) {
    return {
      ok: false,
      action: 'read_image',
      message: '没有在当前群最近上下文里找到这张图片；请使用上下文 images 里的 image_key 或 message_id',
    };
  }

  const { message, record, imageKey, imageIndex } = found;
  const loaded = await imageRecordToInlinePart(record, {
    message_id: message.message_id || null,
    group_id: event.group_id || null,
    user_id: message.user_id || null,
    message_type: message.message_type || 'group',
  });
  if (loaded.ok === false) {
    return {
      ok: false,
      action: 'read_image',
      message_id: message.message_id ?? null,
      image_key: imageKey,
      image_index: imageIndex,
      message: loaded.message,
    };
  }

  return {
    ok: true,
    action: 'read_image',
    message_id: message.message_id ?? null,
    image_key: imageKey,
    image_index: imageIndex,
    speaker_qq: message.user_id ?? null,
    speaker_name: senderNameForMessage(message),
    text: summarizeRawMessage(message.raw_message || message.message || '', event.self_id).slice(0, 300),
    mime_type: loaded.entry.mime_type || 'image/jpeg',
    size: loaded.entry.size || null,
    message: `已读取图片 message_id=${message.message_id ?? '-'} image_index=${imageIndex}`,
    [INTERNAL_INLINE_PARTS_FIELD]: [loaded.part],
  };
}

// 自动附带的图片只包含：当前消息自己的图片、当前消息明确引用链里的图片。
// 其余历史群聊图片一律不主动塞给模型看——只在 RECENT_GROUP_EVENTS_JSONL 里留一个 image_key 文字引用，
// 模型如果判断确实需要看某张历史图片，会自己调用 qq_read_image 工具按需读取（见 buildGroupManagementFunctionDeclarations）。
// 这样可以避免模型被"恰好在附近但没人问"的图片带偏，同时又不会让它彻底看不到旧图。
async function buildGroupContextInlineParts(
  event: OneBotEvent,
  client: OneBotClient,
  cfg: BotConfig,
  quotedMessageChain: ResolvedQuotedMessage[] | null = null
): Promise<Array<Record<string, any>>> {
  if (!event.group_id || !cfg.ai_group_context_enabled) return [];

  const messages: Array<Record<string, any>> = [{ ...event, quote_depth: 0 }];
  if (cfg.ai_group_context_include_quote) {
    const quotedMessages = quotedMessageChain || await resolveQuotedMessageChain(event.raw_message || '', client, 3);
    messages.push(...quotedMessages.map((quoted) => ({
      message_id: quoted.message_id,
      raw_message: quoted.raw_message,
      user_id: quoted.user_id,
      sender: quoted.sender,
      message_type: 'group',
      quote_depth: quoted.quote_depth,
    })));
  }

  const parts: Array<Record<string, any>> = [];
  const seen = new Set<string>();

  for (const message of messages) {
    const raw = String(message.raw_message || message.message || '');
    const records = imageCache.extractImageRecords(raw, {
      ignoreStickers: cfg.ai_filter_stickers !== false,
      maxImages: 5,
    });

    for (const [index, record] of records.entries()) {
      if (parts.length >= MAX_GROUP_CONTEXT_INLINE_IMAGES * 2) return parts;
      const imageKey = imageCache.cacheKeyForRecord(record);
      const dedupeKey = `${message.message_id || ''}:${imageKey}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const loaded = await imageRecordToInlinePart(record, {
        message_id: message.message_id || null,
        group_id: event.group_id || null,
        user_id: message.user_id || null,
        message_type: message.message_type || 'group',
      });
      if (loaded.ok === false) continue;

      parts.push({
        text: [
          'CONTEXT_IMAGE:',
          promptJson({
            message_id: message.message_id ?? null,
            quote_depth: message.quote_depth ?? 0,
            time: formatTime(messageTime(message)),
            speaker_qq: message.user_id ?? null,
            speaker_name: senderNameForMessage(message),
            image_key: imageKey,
            image_index: index + 1,
            text: summarizeRawMessage(raw, event.self_id).slice(0, 200),
          }),
        ].join('\n'),
      });
      parts.push(loaded.part);
    }
  }

  return parts;
}

export {
  buildImageRefs,
  imageRecordToInlinePart,
  executeReadImageTool,
  buildGroupContextInlineParts,
};
