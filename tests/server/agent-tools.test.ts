import { test } from 'node:test';
import assert from 'node:assert/strict';

import { INTERNAL_INLINE_PARTS_FIELD } from '../../lib/server/ai/types.js';
import { limitToolResult } from '../../lib/server/agent/tools.js';

test('tool result limits preserve complete internal image payloads outside textual previews', () => {
  const imageData = 'a'.repeat(300_000);
  const inlineParts = [{
    inline_data: {
      mime_type: 'image/jpeg',
      data: imageData,
    },
  }];

  const result = limitToolResult({
    ok: true,
    message: '已读取图片',
    details: 'x'.repeat(20_000),
    [INTERNAL_INLINE_PARTS_FIELD]: inlineParts,
  }, 4_000);

  assert.strictEqual(result[INTERNAL_INLINE_PARTS_FIELD], inlineParts);
  assert.equal((result[INTERNAL_INLINE_PARTS_FIELD] as typeof inlineParts)[0].inline_data.data.length, 300_000);

  const publicResult = { ...result };
  delete publicResult[INTERNAL_INLINE_PARTS_FIELD];
  const publicText = JSON.stringify(publicResult);
  assert.ok(publicText.length <= 4_500);
  assert.doesNotMatch(publicText, /a{100}/);
});
