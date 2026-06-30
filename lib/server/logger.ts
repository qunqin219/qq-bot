import fs = require('fs');
import path = require('path');
import util = require('util');

const { SERVER_LOG_FILE } = require('./paths') as { SERVER_LOG_FILE: string };

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error';

type LoggerState = {
  installed: boolean;
  stream: fs.WriteStream;
  originals: Record<ConsoleMethod, (...args: any[]) => void>;
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

function installServerLogger(logFile = SERVER_LOG_FILE): LoggerState {
  const current = getLoggerState();
  if (current?.installed) return current;

  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const stream = fs.createWriteStream(logFile, { flags: 'a' });
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

  (Object.keys(levels) as ConsoleMethod[]).forEach((method) => {
    console[method] = (...args: unknown[]) => {
      const formatted = formatConsoleLine(levels[method], args);
      originals[method](formatted);
      stream.write(`${formatted}\n`);
    };
  });

  const state = { installed: true, stream, originals };
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
};

export {};
