// HTTP 重试基础设施 —— 模型无关

import { MAX_HTTP_RETRY_DELAY_MS } from './types.js';

function resolveNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function retryDelayMs(resp: Response, fallbackMs: number): number {
  const retryAfter = resp.headers?.get?.('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(MAX_HTTP_RETRY_DELAY_MS, seconds * 1000);
    }
    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) {
      return Math.min(MAX_HTTP_RETRY_DELAY_MS, Math.max(0, retryAt - Date.now()));
    }
  }
  return Math.min(MAX_HTTP_RETRY_DELAY_MS, Math.max(0, fallbackMs));
}

export {
  resolveNumber,
  sleep,
  isRetryableHttpStatus,
  retryDelayMs,
};
