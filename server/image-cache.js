// QQ 图片本地缓存 —— 收到图片时尽快保存，避免 QQ 临时 URL 过期后无法识图

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CACHE_DIR = process.env.QQ_BOT_IMAGE_CACHE_DIR || path.join(__dirname, '..', 'data', 'images');
const INDEX_FILE = path.join(CACHE_DIR, 'index.json');
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGES_PER_MESSAGE = 5;

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&#44;/g, ',')
    .replace(/&#91;/g, '[')
    .replace(/&#93;/g, ']')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

function parseCqParams(body) {
  const params = {};
  for (const item of String(body || '').split(',')) {
    const idx = item.indexOf('=');
    if (idx === -1) continue;
    const key = item.slice(0, idx).trim();
    const value = item.slice(idx + 1).trim();
    params[key] = decodeHtmlEntities(value);
  }
  return params;
}

function ensureCacheDir() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function loadIndex() {
  try {
    if (!fs.existsSync(INDEX_FILE)) return {};
    const data = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function saveIndex(index) {
  ensureCacheDir();
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2), 'utf8');
}

function isStickerRecord(record) {
  const summary = decodeHtmlEntities(record.summary || '');
  return record.sub_type === '1' || summary === '[动画表情]' || summary.includes('动画表情');
}

function extractImageRecords(message, options = {}) {
  const records = [];
  const raw = String(message || '');
  const re = /\[CQ:image,([^\]]+)\]/g;
  let match;
  while ((match = re.exec(raw)) !== null) {
    const params = parseCqParams(match[1]);
    const record = {
      file: params.file || '',
      url: params.url || '',
      summary: params.summary || '',
      sub_type: params.sub_type || '',
      file_size: params.file_size || '',
      raw: match[0],
    };
    if (options.ignoreStickers && isStickerRecord(record)) continue;
    if (record.url && /^https?:\/\//i.test(record.url)) records.push(record);
  }
  const seen = new Set();
  return records.filter((record) => {
    const key = cacheKeyForRecord(record);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, options.maxImages || MAX_IMAGES_PER_MESSAGE);
}

function hashText(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

function cacheKeyForRecord(record) {
  // QQ 的 file 通常是同一图片的稳定标识；URL 里的 rkey 会过期，不适合单独当长期键。
  if (record?.file) return hashText(`file:${record.file}`);
  return hashText(`url:${record?.url || record?.raw || ''}`);
}

function extFromMime(mimeType) {
  const type = String(mimeType || '').split(';')[0].trim().toLowerCase();
  if (type === 'image/png') return '.png';
  if (type === 'image/webp') return '.webp';
  if (type === 'image/gif') return '.gif';
  if (type === 'image/jpeg' || type === 'image/jpg') return '.jpg';
  return '.img';
}

function extFromRecord(record) {
  const ext = path.extname(String(record?.file || '')).toLowerCase();
  if (/^\.(png|jpg|jpeg|webp|gif)$/.test(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  return '';
}

function getCachedImage(recordOrKey) {
  const key = typeof recordOrKey === 'string' ? recordOrKey : cacheKeyForRecord(recordOrKey);
  const entry = loadIndex()[key];
  if (!entry?.file_path || !fs.existsSync(entry.file_path)) return null;
  return entry;
}

function responseErrorSummary(status, text) {
  const trimmed = String(text || '').slice(0, 200);
  try {
    const data = JSON.parse(trimmed);
    return `${status} ${data.retmsg || data.message || trimmed}`.trim();
  } catch {
    return `${status} ${trimmed}`.trim();
  }
}

async function downloadImage(url) {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 QQBot/1.0',
      Referer: 'https://im.qq.com/',
    },
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    return { ok: false, error: responseErrorSummary(resp.status, errText) };
  }
  const mimeType = (resp.headers.get('content-type') || 'image/jpeg')
    .split(';')[0]
    .trim();
  if (!mimeType.startsWith('image/')) {
    return { ok: false, error: `非图片 content-type: ${mimeType}` };
  }
  const buffer = Buffer.from(await resp.arrayBuffer());
  if (buffer.length > MAX_IMAGE_BYTES) {
    return { ok: false, error: `图片过大: ${buffer.length} bytes` };
  }
  return { ok: true, buffer, mimeType };
}

async function cacheImageRecord(record, meta = {}) {
  if (!record?.url) return null;
  const key = cacheKeyForRecord(record);
  const cached = getCachedImage(key);
  if (cached) return cached;

  try {
    const downloaded = await downloadImage(record.url);
    if (!downloaded.ok) {
      console.warn(`[ImageCache] 图片缓存失败 key=${key.slice(0, 12)} ${downloaded.error}`);
      return null;
    }

    ensureCacheDir();
    const ext = extFromRecord(record) || extFromMime(downloaded.mimeType);
    const filePath = path.join(CACHE_DIR, `${key}${ext}`);
    fs.writeFileSync(filePath, downloaded.buffer);

    const entry = {
      key,
      file_path: filePath,
      mime_type: downloaded.mimeType,
      size: downloaded.buffer.length,
      qq_file: record.file || '',
      source_url: record.url,
      cached_at: new Date().toISOString(),
      message_id: meta.message_id || null,
      group_id: meta.group_id || null,
      user_id: meta.user_id || null,
      message_type: meta.message_type || null,
    };
    const index = loadIndex();
    index[key] = entry;
    saveIndex(index);
    console.log(`[ImageCache] 已缓存图片 key=${key.slice(0, 12)} size=${entry.size}`);
    return entry;
  } catch (e) {
    console.warn(`[ImageCache] 图片缓存异常 key=${key.slice(0, 12)} ${e.message}`);
    return null;
  }
}

async function cacheImagesFromMessage(message, meta = {}, options = {}) {
  const records = extractImageRecords(message, {
    ignoreStickers: options.ignoreStickers !== false,
    maxImages: options.maxImages || MAX_IMAGES_PER_MESSAGE,
  });
  const results = [];
  for (const record of records) {
    results.push(await cacheImageRecord(record, meta));
  }
  return results.filter(Boolean);
}

module.exports = {
  CACHE_DIR,
  MAX_IMAGE_BYTES,
  decodeHtmlEntities,
  extractImageRecords,
  cacheKeyForRecord,
  getCachedImage,
  cacheImageRecord,
  cacheImagesFromMessage,
};
