// Gemini 图片处理 —— inline_data 格式转换

import type { ImageCacheEntry, ImageRecord } from '../../image-cache.js';
import type { InlineDataPart } from '../types.js';

import fs from 'fs';
import * as imageCache from '../../image-cache.js';
import { MAX_IMAGE_BYTES } from '../types.js';
import { errorMessage } from '../utils.js';

async function imageUrlToPart(url: string): Promise<InlineDataPart | null> {
  try {
    const downloaded = await imageCache.downloadImage(url);
    if (!downloaded.ok) {
      console.warn(`[AI] 图片下载失败: ${downloaded.error}`);
      return null;
    }
    // generateContent REST 多模态字段；大多数中转兼容 inline_data。
    return {
      inline_data: {
        mime_type: downloaded.mimeType,
        data: downloaded.buffer.toString('base64'),
      },
    };
  } catch (e: unknown) {
    console.warn('[AI] 图片下载异常:', errorMessage(e));
    return null;
  }
}

function cachedImageToPart(entry: ImageCacheEntry | null): InlineDataPart | null {
  if (!entry?.file_path || !fs.existsSync(entry.file_path)) return null;
  const buf = fs.readFileSync(entry.file_path);
  if (buf.length > MAX_IMAGE_BYTES) {
    console.warn(`[AI] 缓存图片过大，已跳过: ${buf.length} bytes`);
    return null;
  }
  return {
    inline_data: {
      mime_type: entry.mime_type || 'image/jpeg',
      data: buf.toString('base64'),
    },
  };
}

async function imageRecordToPart(record: ImageRecord): Promise<InlineDataPart | null> {
  const cached = imageCache.getCachedImage(record);
  if (cached) {
    const part = cachedImageToPart(cached);
    if (part) return part;
  }

  // 当前消息里的 QQ URL 通常还没过期；这里顺手缓存，之后引用旧图就不依赖临时链接。
  const cachedNow = await imageCache.cacheImageRecord(record, {});
  if (cachedNow) {
    const part = cachedImageToPart(cachedNow);
    if (part) return part;
  }

  return record.url ? imageUrlToPart(record.url) : null;
}

export {
  imageUrlToPart,
  cachedImageToPart,
  imageRecordToPart,
};
