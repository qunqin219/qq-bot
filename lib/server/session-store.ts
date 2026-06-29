const session = require('express-session') as any;
const { readJsonFile, writeJsonFileAtomic } = require('./json-store') as {
  readJsonFile<T>(_filePath: string, _fallback: T, _validate?: ((_data: unknown) => _data is T) | null): T;
  writeJsonFileAtomic(_filePath: string, _data: unknown): void;
};

type SessionData = Record<string, any>;
type SessionMap = Record<string, SessionData>;
type StoreCallback = (_err?: unknown, _session?: SessionData | null) => void;

const DEFAULT_TOUCH_WRITE_INTERVAL_MS = 60_000;

function getTouchWriteIntervalMs(): number {
  const configured = Number(process.env.QQ_BOT_SESSION_TOUCH_WRITE_INTERVAL_MS);
  if (!Number.isFinite(configured) || configured < 0) return DEFAULT_TOUCH_WRITE_INTERVAL_MS;
  return configured;
}

function getCookieExpiresMs(sess: SessionData | null | undefined): number | null {
  const expires = sess?.cookie?.expires;
  if (!expires) return null;
  const time = expires instanceof Date ? expires.getTime() : Date.parse(String(expires));
  return Number.isFinite(time) ? time : null;
}

class FileSessionStore extends session.Store {
  private filePath: string;

  constructor(filePath: string) {
    super();
    this.filePath = filePath;
  }

  _read(): SessionMap {
    return readJsonFile<SessionMap>(this.filePath, {}, (data): data is SessionMap => {
      return Boolean(data) && typeof data === 'object' && !Array.isArray(data);
    });
  }

  _write(sessions: SessionMap): void {
    writeJsonFileAtomic(this.filePath, sessions);
  }

  _isExpired(sess: SessionData | null | undefined): boolean {
    const expires = sess?.cookie?.expires;
    return expires ? Date.parse(expires) <= Date.now() : false;
  }

  _prune(sessions: SessionMap): boolean {
    let changed = false;
    for (const [sid, sess] of Object.entries(sessions)) {
      if (this._isExpired(sess)) {
        delete sessions[sid];
        changed = true;
      }
    }
    return changed;
  }

  get(sid: string, cb: StoreCallback): void {
    try {
      const sessions = this._read();
      const sess = sessions[sid] || null;
      if (sess && this._isExpired(sess)) {
        delete sessions[sid];
        this._write(sessions);
        cb(null, null);
        return;
      }
      cb(null, sess);
    } catch (e) {
      cb(e);
    }
  }

  set(sid: string, sess: SessionData, cb: StoreCallback = () => {}): void {
    try {
      const sessions = this._read();
      this._prune(sessions);
      sessions[sid] = sess;
      this._write(sessions);
      cb(null);
    } catch (e) {
      cb(e);
    }
  }

  destroy(sid: string, cb: StoreCallback = () => {}): void {
    try {
      const sessions = this._read();
      delete sessions[sid];
      this._write(sessions);
      cb(null);
    } catch (e) {
      cb(e);
    }
  }

  touch(sid: string, sess: SessionData, cb: StoreCallback = () => {}): void {
    try {
      const sessions = this._read();
      const pruned = this._prune(sessions);
      const existing = sessions[sid];
      if (!existing) {
        sessions[sid] = sess;
        this._write(sessions);
        cb(null);
        return;
      }

      const currentExpires = getCookieExpiresMs(existing);
      const nextExpires = getCookieExpiresMs(sess);
      const intervalMs = getTouchWriteIntervalMs();
      if (
        !pruned &&
        intervalMs > 0 &&
        currentExpires !== null &&
        nextExpires !== null &&
        Math.abs(nextExpires - currentExpires) < intervalMs
      ) {
        cb(null);
        return;
      }

      sessions[sid] = { ...existing, cookie: sess.cookie };
      this._write(sessions);
      cb(null);
    } catch (e) {
      cb(e);
    }
  }
}

module.exports = { FileSessionStore };

export {};
