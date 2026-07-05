import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAiReplyDirective, userExplicitlyAskedForQuote, userLikelyTargetsContextMessage } from '../../lib/server/bot/reply.js';

test('parseAiReplyDirective: 全角冒号 + 换行解析引用 ID', () => {
  assert.deepEqual(parseAiReplyDirective('引用消息ID：12345\n你好'), { text: '你好', replyMessageId: 12345 });
});

test('parseAiReplyDirective: 半角冒号变体', () => {
  assert.deepEqual(parseAiReplyDirective('引用消息ID:99\nhello'), { text: 'hello', replyMessageId: 99 });
});

test('parseAiReplyDirective: 无引用指令返回原文本', () => {
  assert.deepEqual(parseAiReplyDirective('普通回复'), { text: '普通回复', replyMessageId: null });
});

test('parseAiReplyDirective: 空字符串', () => {
  assert.deepEqual(parseAiReplyDirective(''), { text: '', replyMessageId: null });
});

test('userExplicitlyAskedForQuote: 请引用这条 -> true', () => {
  assert.equal(userExplicitlyAskedForQuote('请引用这条'), true);
});

test('userExplicitlyAskedForQuote: 随便说 -> false', () => {
  assert.equal(userExplicitlyAskedForQuote('随便说'), false);
});

test('userExplicitlyAskedForQuote: 回一下 -> true', () => {
  assert.equal(userExplicitlyAskedForQuote('回一下'), true);
});

test('userLikelyTargetsContextMessage: 他说的对 -> true', () => {
  assert.equal(userLikelyTargetsContextMessage('他说的对'), true);
});

test('userLikelyTargetsContextMessage: 还有吗 -> false', () => {
  assert.equal(userLikelyTargetsContextMessage('还有吗'), false);
});

test('userLikelyTargetsContextMessage: 引用会自动判为 true', () => {
  assert.equal(userLikelyTargetsContextMessage('请引用这条'), true);
});

