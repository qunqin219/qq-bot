import fs = require('fs');
import path = require('path');
import util = require('util');

const { SERVER_LOG_FILE } = require('./paths') as { SERVER_LOG_FILE: string };

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error';

type LoggerState = {
  installed: boolean;
  stream: fs.WriteStream;
  originals: Record<ConsoleMethod, (...args: any[]) => void>;
  mirrorToFile: Record<ConsoleMethod, boolean>;
};

const LOGGER_STATE_KEY = Symbol.for('qq-bot.server-logger');

function padMilliseconds(value: number): string {
  return String(value).padStart(3, '0');
}

function beijingTimestamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}.${padMilliseconds(date.getMilliseconds())} CST`;
}

function formatConsoleLine(level: string, args: unknown[], date = new Date()): string {
  const prefix = `[${beijingTimestamp(date)}] [${level}] `;
  const text = util.format(...args);
  return text
    .split(/\r?\n/)
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function getLoggerState(): LoggerState | null {
  return (globalThis as any)[LOGGER_STATE_KEY] || null;
}

function setLoggerState(state: LoggerState): void {
  (globalThis as any)[LOGGER_STATE_KEY] = state;
}

function sameFileStat(a: fs.Stats, b: fs.Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

function fdTargetsFile(fd: number, filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    return sameFileStat(fs.fstatSync(fd), fs.statSync(filePath));
  } catch {
    return false;
  }
}

// 日志轮转：server.log 在生产环境里往往是被 systemd 用 `append:` 直接重定向 stdout/stderr 写的，
// 我们进程内部的 fs.WriteStream 未必是真正落盘的那一路（见 installServerLogger 里 mirrorToFile 的判断）。
// 这意味着不能用“重命名旧文件 + 新建 stream”的常规轮转方式——重命名后，systemd/我们自己进程的 fd 仍然
// 指向被改名的旧 inode，新文件不会有任何东西写进去。
// 这里改用 copytruncate 方式：把当前内容拷贝到编号备份里，再把原文件截断为 0 字节。
// truncate 只改变文件长度，不会影响任何已经打开的 fd，所以不管是谁持有这个 fd，后续写入都会从头开始追加，
// 效果上等价于“轮转”，且不需要重启进程、不需要重新打开文件。
const MAX_LOG_SIZE_BYTES = 20 * 1024 * 1024; // 20MB
const MAX_ROTATED_FILES = 5;
const ROTATE_CHECK_INTERVAL_MS = 10_000;
let lastRotateCheckAt = 0;

function rotateLogFileIfNeeded(logFile: string, now = Date.now()): void {
  if (now - lastRotateCheckAt < ROTATE_CHECK_INTERVAL_MS) return;
  lastRotateCheckAt = now;

  let size = 0;
  try {
    size = fs.statSync(logFile).size;
  } catch {
    return;
  }
  if (size < MAX_LOG_SIZE_BYTES) return;

  try {
    const oldestBackup = `${logFile}.${MAX_ROTATED_FILES}`;
    if (fs.existsSync(oldestBackup)) fs.unlinkSync(oldestBackup);
    for (let i = MAX_ROTATED_FILES - 1; i >= 1; i--) {
      const src = `${logFile}.${i}`;
      if (fs.existsSync(src)) fs.renameSync(src, `${logFile}.${i + 1}`);
    }
    fs.copyFileSync(logFile, `${logFile}.1`);
    fs.truncateSync(logFile, 0);
  } catch {
    // 轮转失败不应该影响正常日志写入，下次到检查间隔时再重试
  }
}

function installServerLogger(logFile = SERVER_LOG_FILE): LoggerState {
  const current = getLoggerState();
  if (current?.installed) return current;

  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const stream = fs.createWriteStream(logFile, { flags: 'a' });
  const stdoutAlreadyWritesLog = fdTargetsFile(1, logFile);
  const stderrAlreadyWritesLog = fdTargetsFile(2, logFile);
  const originals: LoggerState['originals'] = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  const levels: Record<ConsoleMethod, string> = {
    log: 'INFO',
    info: 'INFO',
    warn: 'WARN',
    error: 'ERROR',
  };
  const mirrorToFile: Record<ConsoleMethod, boolean> = {
    log: !stdoutAlreadyWritesLog,
    info: !stdoutAlreadyWritesLog,
    warn: !stderrAlreadyWritesLog,
    error: !stderrAlreadyWritesLog,
  };

  (Object.keys(levels) as ConsoleMethod[]).forEach((method) => {
    console[method] = (...args: unknown[]) => {
      const formatted = formatConsoleLine(levels[method], args);
      originals[method](formatted);
      if (mirrorToFile[method]) {
        stream.write(`${formatted}\n`);
      }
      rotateLogFileIfNeeded(logFile);
    };
  });

  const state = {
    installed: true,
    stream,
    originals,
    mirrorToFile,
  };
  setLoggerState(state);
  return state;
}

function flushServerLogger(callback?: () => void): void {
  const current = getLoggerState();
  if (!current?.installed) {
    callback?.();
    return;
  }
  if (current.stream.closed || current.stream.destroyed) {
    callback?.();
    return;
  }
  current.stream.end(callback);
}

module.exports = {
  beijingTimestamp,
  formatConsoleLine,
  installServerLogger,
  flushServerLogger,
  rotateLogFileIfNeeded,
};

export {};
