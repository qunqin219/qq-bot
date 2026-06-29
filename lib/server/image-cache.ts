// QQ 图片本地缓存 —— 收到图片时尽快保存，避免 QQ 临时 URL 过期后无法识图

import type { LookupAddress } from 'dns';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const { IMAGE_CACHE_DIR } = require('./paths');
const { readJsonFile, writeJsonFileAtomic } = require('./json-store');

const CACHE_DIR = IMAGE_CACHE_DIR;
const INDEX_FILE = path.join(CACHE_DIR, 'index.json');
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGES_PER_MESSAGE = 5;
const FETCH_TIMEOUT_MS = Math.max(1000, Math.min(30000, Number(process.env.QQ_BOT_IMAGE_FETCH_TIMEOUT_MS || 8000)));
const MAX_REDIRECTS = 3;
const DEFAULT_ALLOWED_HOST_SUFFIXES = [
  'qpic.cn',
  'gtimg.cn',
  'qq.com',
  'tencent.com',
  'myqcloud.com',
];

export type ImageRecord = {
  file: string;
  url: string;
  summary: string;
  sub_type: string;
  file_size: string;
  raw: string;
};

export type ImageCacheEntry = {
  key: string;
  file_path: string;
  mime_type: string;
  size: number;
  qq_file: string;
  source_url: string;
  cached_at: string;
  message_id: number | string | null;
  group_id: number | string | null;
  user_id: number | string | null;
  message_type: string | null;
};

type ImageCacheIndex = Record<string, ImageCacheEntry>;

type ExtractImageOptions = {
  ignoreStickers?: boolean;
  maxImages?: number;
};

type ImageCacheMeta = {
  message_id?: number | string | null;
  group_id?: number | string | null;
  user_id?: number | string | null;
  message_type?: string | null;
};

type ValidationResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

type FetchImageResult =
  | { ok: true; resp: Response }
  | { ok: false; error: string };

export type DownloadImageResult =
  | { ok: true; buffer: Buffer; mimeType: string }
  | { ok: false; error: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function parseCqParams(body: unknown): Record<string, string> {
  const params: Record<string, string> = {};
  for (const item of String(body || '').split(',')) {
    const idx = item.indexOf('=');
    if (idx === -1) continue;
    const key = item.slice(0, idx).trim();
    const value = item.slice(idx + 1).trim();
    params[key] = decodeHtmlEntities(value);
  }
  return params;
}

function ensureCacheDir(): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function loadIndex(): ImageCacheIndex {
  return readJsonFile(INDEX_FILE, {}, (data: unknown) => data && typeof data === 'object' && !Array.isArray(data));
}

function saveIndex(index: ImageCacheIndex): void {
  ensureCacheDir();
  writeJsonFileAtomic(INDEX_FILE, index);
}

function isStickerRecord(record: ImageRecord): boolean {
  const summary = decodeHtmlEntities(record.summary || '');
  return record.sub_type === '1' || summary === '[动画表情]' || summary.includes('动画表情');
}

function extractImageRecords(message: unknown, options: ExtractImageOptions = {}): ImageRecord[] {
  const records: ImageRecord[] = [];
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
  const seen = new Set<string>();
  return records.filter((record) => {
    const key = cacheKeyForRecord(record);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, options.maxImages || MAX_IMAGES_PER_MESSAGE);
}

function hashText(text: unknown): string {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

function cacheKeyForRecord(record: ImageRecord | null | undefined): string {
  // QQ 的 file 通常是同一图片的稳定标识；URL 里的 rkey 会过期，不适合单独当长期键。
  if (record?.file) return hashText(`file:${record.file}`);
  return hashText(`url:${record?.url || record?.raw || ''}`);
}

function extFromMime(mimeType: unknown): string {
  const type = String(mimeType || '').split(';')[0].trim().toLowerCase();
  if (type === 'image/png') return '.png';
  if (type === 'image/webp') return '.webp';
  if (type === 'image/gif') return '.gif';
  if (type === 'image/jpeg' || type === 'image/jpg') return '.jpg';
  return '.img';
}

function extFromRecord(record: ImageRecord | null | undefined): string {
  const ext = path.extname(String(record?.file || '')).toLowerCase();
  if (/^\.(png|jpg|jpeg|webp|gif)$/.test(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  return '';
}

function getCachedImage(recordOrKey: ImageRecord | string): ImageCacheEntry | null {
  const key = typeof recordOrKey === 'string' ? recordOrKey : cacheKeyForRecord(recordOrKey);
  const entry = loadIndex()[key];
  if (!entry?.file_path || !fs.existsSync(entry.file_path)) return null;
  return entry;
}

function responseErrorSummary(status: number, text: unknown): string {
  const trimmed = String(text || '').slice(0, 200);
  try {
    const data = JSON.parse(trimmed);
    return `${status} ${data.retmsg || data.message || trimmed}`.trim();
  } catch {
    return `${status} ${trimmed}`.trim();
  }
}

function allowLocalImageFetch(): boolean {
  return process.env.QQ_BOT_ALLOW_LOCAL_IMAGE_FETCH === '1';
}

function allowedHostSuffixes(): string[] {
  const raw = process.env.QQ_BOT_IMAGE_ALLOWED_HOSTS;
  if (!raw) return DEFAULT_ALLOWED_HOST_SUFFIXES;
  return raw.split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeHostname(hostname: unknown): string {
  return String(hostname || '').toLowerCase().replace(/\.$/, '');
}

function hostMatchesAllowedSuffix(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  return allowedHostSuffixes().some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function isPrivateIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (version === 6) {
    const value = ip.toLowerCase();
    if (value === '::1' || value === '::') return true;
    if (value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:')) return true;
    if (value.startsWith('::ffff:')) {
      return isPrivateIp(value.slice('::ffff:'.length));
    }
    return false;
  }
  return false;
}

async function resolveHostname(hostname: string): Promise<string[]> {
  const host = normalizeHostname(hostname);
  if (net.isIP(host)) return [host];
  const lookup = dns.lookup(host, { all: true, verbatim: true });
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('DNS lookup timeout')), 3000).unref();
  });
  const records = await Promise.race([lookup, timeout]) as LookupAddress[];
  return records.map((record) => record.address);
}

async function validateImageUrl(rawUrl: unknown): Promise<ValidationResult> {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || ''));
  } catch {
    return { ok: false, error: '图片 URL 无效' };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, error: `不支持的图片协议: ${parsed.protocol}` };
  }

  const host = normalizeHostname(parsed.hostname);
  const localAllowed = allowLocalImageFetch();
  if (!localAllowed && !hostMatchesAllowedSuffix(host)) {
    return { ok: false, error: `图片域名不在允许列表: ${host}` };
  }

  let addresses;
  try {
    addresses = await resolveHostname(host);
  } catch (e: unknown) {
    return { ok: false, error: `图片域名解析失败: ${errorMessage(e)}` };
  }

  if (!localAllowed && addresses.some(isPrivateIp)) {
    return { ok: false, error: `图片域名解析到内网地址: ${host}` };
  }

  return { ok: true, url: parsed.toString() };
}

async function fetchImageResponse(rawUrl: string, headers: HeadersInit = {}): Promise<FetchImageResult> {
  let currentUrl = rawUrl;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const validation = await validateImageUrl(currentUrl);
    if (validation.ok === false) return { ok: false, error: validation.error };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const resp = await fetch(validation.url, {
        headers,
        redirect: 'manual',
        signal: controller.signal,
      });
      const location = resp.headers.get('location');
      if (resp.status >= 300 && resp.status < 400 && location) {
        currentUrl = new URL(location, validation.url).toString();
        continue;
      }
      return { ok: true, resp };
    } catch (e: unknown) {
      const isAbort = e instanceof Error && e.name === 'AbortError';
      return { ok: false, error: isAbort ? '图片下载超时' : errorMessage(e) };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, error: '图片跳转次数过多' };
}

async function downloadImage(url: string): Promise<DownloadImageResult> {
  const fetched = await fetchImageResponse(url, {
    'User-Agent': 'Mozilla/5.0 QQBot/1.0',
    Referer: 'https://im.qq.com/',
  });
  if (fetched.ok === false) return { ok: false, error: fetched.error };
  const { resp } = fetched;
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
  const contentLength = Number(resp.headers.get('content-length') || 0);
  if (contentLength > MAX_IMAGE_BYTES) {
    return { ok: false, error: `图片过大: ${contentLength} bytes` };
  }
  const buffer = Buffer.from(await resp.arrayBuffer());
  if (buffer.length > MAX_IMAGE_BYTES) {
    return { ok: false, error: `图片过大: ${buffer.length} bytes` };
  }
  return { ok: true, buffer, mimeType };
}

async function cacheImageRecord(record: ImageRecord, meta: ImageCacheMeta = {}): Promise<ImageCacheEntry | null> {
  if (!record?.url) return null;
  const key = cacheKeyForRecord(record);
  const cached = getCachedImage(key);
  if (cached) return cached;

  try {
    const downloaded = await downloadImage(record.url);
    if (downloaded.ok === false) {
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
  } catch (e: unknown) {
    console.warn(`[ImageCache] 图片缓存异常 key=${key.slice(0, 12)} ${errorMessage(e)}`);
    return null;
  }
}

async function cacheImagesFromMessage(
  message: unknown,
  meta: ImageCacheMeta = {},
  options: ExtractImageOptions = {}
): Promise<ImageCacheEntry[]> {
  const records = extractImageRecords(message, {
    ignoreStickers: options.ignoreStickers !== false,
    maxImages: options.maxImages || MAX_IMAGES_PER_MESSAGE,
  });
  const results: Array<ImageCacheEntry | null> = [];
  for (const record of records) {
    results.push(await cacheImageRecord(record, meta));
  }
  return results.filter((entry): entry is ImageCacheEntry => Boolean(entry));
}

module.exports = {
  CACHE_DIR,
  MAX_IMAGE_BYTES,
  decodeHtmlEntities,
  extractImageRecords,
  cacheKeyForRecord,
  getCachedImage,
  validateImageUrl,
  downloadImage,
  cacheImageRecord,
  cacheImagesFromMessage,
};
