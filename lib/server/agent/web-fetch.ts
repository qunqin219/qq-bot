import { isPrivateIp, normalizeHostname, resolveHostname } from '../image-cache.js';

const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_RESULT_CHARS = 18_000;

type FetchDependencies = {
  fetchImpl?: typeof fetch;
  resolve?: (hostname: string) => Promise<string[]>;
};

type ValidationResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function decodeEntities(text: string): string {
  const entities: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ',
  };
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const normalized = entity.toLowerCase();
    if (normalized.startsWith('#x')) {
      const code = Number.parseInt(normalized.slice(2), 16);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    if (normalized.startsWith('#')) {
      const code = Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return entities[normalized] ?? match;
  });
}

function normalizeText(text: string): string {
  return decodeEntities(text)
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractReadableContent(raw: string, contentType: string): { title: string; text: string } {
  if (!/html|xhtml/i.test(contentType)) {
    return { title: '', text: normalizeText(raw) };
  }
  const titleMatch = raw.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = normalizeText(String(titleMatch?.[1] || '').replace(/<[^>]*>/g, ' ')).slice(0, 300);
  const text = raw
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<(script|style|noscript|svg|canvas|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|hr)\b[^>]*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|section|article|main|header|footer|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return { title, text: normalizeText(text) };
}

async function validatePublicWebUrl(
  rawUrl: unknown,
  resolver: (hostname: string) => Promise<string[]> = resolveHostname
): Promise<ValidationResult> {
  let url: URL;
  try {
    url = new URL(String(rawUrl || '').trim());
  } catch {
    return { ok: false, error: 'URL 无效' };
  }
  if (!['http:', 'https:'].includes(url.protocol)) return { ok: false, error: `不支持的协议：${url.protocol}` };
  if (url.username || url.password) return { ok: false, error: 'URL 不能包含用户名或密码' };
  const hostname = normalizeHostname(url.hostname);
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    return { ok: false, error: '禁止访问本机或局域网主机' };
  }
  let addresses: string[];
  try {
    addresses = await resolver(hostname);
  } catch (error) {
    return { ok: false, error: `域名解析失败：${errorMessage(error)}` };
  }
  if (addresses.length === 0) return { ok: false, error: '域名没有可用地址' };
  if (addresses.some(isPrivateIp)) return { ok: false, error: '禁止访问内网、回环或链路本地地址' };
  url.hash = '';
  return { ok: true, url: url.toString() };
}

async function readLimitedText(response: Response): Promise<{ text: string; truncated: boolean }> {
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_RESPONSE_BYTES) throw new Error(`响应体超过 ${MAX_RESPONSE_BYTES} 字节限制`);
  if (!response.body?.getReader) {
    const text = await response.text();
    return { text: text.slice(0, MAX_RESPONSE_BYTES), truncated: text.length > MAX_RESPONSE_BYTES };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        const allowed = Math.max(0, value.byteLength - (size - MAX_RESPONSE_BYTES));
        if (allowed > 0) text += decoder.decode(value.subarray(0, allowed), { stream: true });
        truncated = true;
        await reader.cancel();
        break;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { text, truncated };
  } finally {
    reader.releaseLock();
  }
}

async function executeWebFetch(
  args: Record<string, unknown>,
  signal?: AbortSignal,
  dependencies: FetchDependencies = {}
): Promise<Record<string, unknown>> {
  const fetchImpl = dependencies.fetchImpl || fetch;
  const resolver = dependencies.resolve || resolveHostname;
  let currentUrl = String(args.url || '').trim();
  if (!currentUrl) return { ok: false, message: 'url 不能为空' };
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(signal?.reason);
  if (signal?.aborted) abortFromParent();
  else signal?.addEventListener('abort', abortFromParent, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('web_fetch timeout')), FETCH_TIMEOUT_MS);
  timer.unref();

  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const validation = await validatePublicWebUrl(currentUrl, resolver);
      if (!validation.ok) return { ok: false, message: validation.error };
      const response = await fetchImpl(validation.url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/json,text/plain,application/xml,text/xml;q=0.9,*/*;q=0.1',
          'User-Agent': 'QQBot-Agent-WebFetch/1.0',
        },
      });
      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        currentUrl = new URL(location, validation.url).toString();
        continue;
      }
      if (!response.ok) {
        return { ok: false, status: response.status, url: validation.url, message: `网页请求失败：HTTP ${response.status}` };
      }
      const contentType = String(response.headers.get('content-type') || 'text/plain').split(';')[0].toLowerCase();
      const supported = contentType.startsWith('text/') || [
        'application/json', 'application/ld+json', 'application/xml', 'application/xhtml+xml',
      ].includes(contentType);
      if (!supported) return { ok: false, status: response.status, url: validation.url, message: `不支持的 content-type：${contentType}` };
      const raw = await readLimitedText(response);
      const content = extractReadableContent(raw.text, contentType);
      const clipped = content.text.slice(0, MAX_RESULT_CHARS);
      return {
        ok: true,
        url: validation.url,
        status: response.status,
        content_type: contentType,
        title: content.title,
        text: clipped,
        truncated: raw.truncated || content.text.length > MAX_RESULT_CHARS,
        message: clipped ? '网页内容读取成功' : '网页请求成功，但没有提取到可读文本',
      };
    }
    return { ok: false, message: `网页跳转超过 ${MAX_REDIRECTS} 次` };
  } catch (error) {
    const aborted = controller.signal.aborted;
    return { ok: false, message: aborted ? '网页读取已取消或超时' : `网页读取失败：${errorMessage(error)}` };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromParent);
  }
}

export { executeWebFetch, extractReadableContent, validatePublicWebUrl };
