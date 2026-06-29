import fs = require('fs');
import path = require('path');
import { randomUUID } from 'crypto';

type JsonValidator<T> = (data: unknown) => data is T;

function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJsonFile<T>(filePath: string, fallback: T, validate: JsonValidator<T> | null = null): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf-8');
    if (!raw.trim()) return fallback;
    const data = JSON.parse(raw);
    if (typeof validate === 'function' && !validate(data)) return fallback;
    return data;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`[JsonStore] 读取失败 ${filePath}:`, message);
    return fallback;
  }
}

function writeJsonFileAtomic(filePath: string, data: unknown): void {
  ensureParentDir(filePath);
  const tmpPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

module.exports = { ensureParentDir, readJsonFile, writeJsonFileAtomic };
