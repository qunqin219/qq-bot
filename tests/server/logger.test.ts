import { test } from 'node:test';
import assert from 'node:assert/strict';

import { beijingTimestamp, formatConsoleLine } from '../../lib/server/logger.js';

test('logger formats timestamps in Beijing time', () => {
  const text = beijingTimestamp(new Date('2026-06-30T12:34:56.789Z'));
  assert.equal(text, '2026-06-30 20:34:56.789 CST');
});

test('logger prefixes console lines with timestamp and level', () => {
  const line = formatConsoleLine('INFO', ['[AI] 回复开始', { ok: true }], new Date('2026-06-30T12:34:56.789Z'));
  assert.match(line, /^\[2026-06-30 20:34:56\.789 CST\] \[INFO\] \[AI\] 回复开始 \{ ok: true \}$/);
});

