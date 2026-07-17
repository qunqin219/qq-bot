import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveQuotedMessageChain } from '../../lib/server/bot/context/quote-chain.js';

test('quote chain follows explicit reply edges with depth and cycle bounds', async () => {
  const calls: string[] = [];
  const client = {
    getMsg: async (messageId: number | string) => {
      const id = String(messageId);
      calls.push(id);
      return {
        status: 'ok',
        data: {
          message_id: id,
          user_id: Number(id),
          raw_message: id === '1' ? '[CQ:reply,id=2] first' : '[CQ:reply,id=1] second',
          sender: { nickname: `user-${id}` },
        },
      };
    },
  };

  const chain = await resolveQuotedMessageChain('[CQ:reply,id=1]', client, 3);

  assert.deepEqual(calls, ['1', '2']);
  assert.deepEqual(chain.map((message) => message.quote_depth), [1, 2]);
  assert.deepEqual(chain.map((message) => String(message.message_id)), ['1', '2']);
});
