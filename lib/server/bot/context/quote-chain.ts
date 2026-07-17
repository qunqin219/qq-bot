import type { OneBotClient } from '../types.js';

import { extractReplyMessageId } from '../utils.js';

type ResolvedQuotedMessage = {
  quote_depth: number;
  message_id: number | string;
  raw_message: string;
  user_id: number | string | null;
  sender: Record<string, any>;
  reply_to_message_id: string | null;
};

/**
 * Resolve the explicit reply graph starting at one OneBot message.
 *
 * This is deliberately structural: callers do not need to guess from phrases
 * such as "这个" or "你觉得呢". A bounded depth and cycle guard keep malformed
 * or adversarial reply graphs from causing unbounded API calls.
 */
async function resolveQuotedMessageChain(
  rawMessage: unknown,
  client: OneBotClient,
  maxDepth = 3
): Promise<ResolvedQuotedMessage[]> {
  if (!client?.getMsg) return [];

  const chain: ResolvedQuotedMessage[] = [];
  const seen = new Set<string>();
  let replyId: string | null = extractReplyMessageId(rawMessage);
  const safeMaxDepth = Math.max(1, Math.min(5, Number(maxDepth) || 3));

  for (let depth = 1; replyId && depth <= safeMaxDepth; depth += 1) {
    if (seen.has(replyId)) break;
    seen.add(replyId);

    const result = await client.getMsg(replyId);
    if (!result || result.status !== 'ok' || !result.data) break;

    const data = result.data;
    const raw = String(data.raw_message || data.message || '');
    const nextReplyId = extractReplyMessageId(raw);
    chain.push({
      quote_depth: depth,
      message_id: data.message_id ?? replyId,
      raw_message: raw,
      user_id: data.user_id ?? null,
      sender: data.sender || {},
      reply_to_message_id: nextReplyId,
    });
    replyId = nextReplyId;
  }

  return chain;
}

export { resolveQuotedMessageChain };
export type { ResolvedQuotedMessage };
