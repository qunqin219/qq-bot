import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractReplyMessageId, extractAtUserIds, annotateAtMentions, isBotMentionedRaw, isOnlyBotMentionMessage, idsEqual, compactJson, previewText, summarizeToolResult, summarizeOneBotResult } from '../../lib/server/bot/utils.js';

test('extractReplyMessageId: 提取 reply id', () => {
  assert.equal(extractReplyMessageId('[CQ:reply,id=12345]hello'), '12345');
});

test('extractReplyMessageId: 无 reply 返回 null', () => {
  assert.equal(extractReplyMessageId('no reply here'), null);
});

test('extractReplyMessageId: 空输入返回 null', () => {
  assert.equal(extractReplyMessageId(''), null);
});

test('extractAtUserIds: 提取多个 @ 用户', () => {
  assert.deepEqual(extractAtUserIds('[CQ:at,qq=111] [CQ:at,qq=222]'), [111, 222]);
});

test('extractAtUserIds: 无 @ 返回空数组', () => {
  assert.deepEqual(extractAtUserIds('no ats'), []);
});

test('extractAtUserIds: 去重相同 @', () => {
  assert.deepEqual(extractAtUserIds('[CQ:at,qq=111] [CQ:at,qq=111]'), [111]);
});

test('annotateAtMentions: selfId 为 null 时标注 QQ', () => {
  assert.equal(annotateAtMentions('[CQ:at,qq=111] hi', null), '@QQ=111 hi');
});

test('annotateAtMentions: 命中 bot id 时标注 @Bot', () => {
  assert.equal(annotateAtMentions('[CQ:at,qq=100] hi', 100), '@Bot hi');
});

test('isBotMentionedRaw: 命中 bot -> true', () => {
  assert.equal(isBotMentionedRaw('[CQ:at,qq=100]', 100), true);
});

test('isBotMentionedRaw: 普通文本 -> false', () => {
  assert.equal(isBotMentionedRaw('hello', 100), false);
});

test('isBotMentionedRaw: selfId 为空 -> false', () => {
  assert.equal(isBotMentionedRaw('[CQ:at,qq=100]', null), false);
});

test('isOnlyBotMentionMessage: 引用消息再 @Bot 不是空唤醒', () => {
  assert.equal(isOnlyBotMentionMessage('[CQ:reply,id=123][CQ:at,qq=100]', 100), false);
});

test('idsEqual: 数字与字符串相等', () => {
  assert.equal(idsEqual(123, '123'), true);
});

test('idsEqual: 不相等', () => {
  assert.equal(idsEqual(123, 456), false);
});

test('idsEqual: null 输入返回 false', () => {
  assert.equal(idsEqual(null, 1), false);
});

test('compactJson: 对象紧凑序列化', () => {
  assert.equal(compactJson({ a: 1 }), '{"a":1}');
});

test('compactJson: 超长文本被截断为 903', () => {
  assert.equal(compactJson('x'.repeat(1000)).length, 903);
});

test('compactJson: 短字符串被 JSON 包裹', () => {
  assert.equal(compactJson('short'), '"short"');
});

test('previewText: 折叠空白并 trim', () => {
  assert.equal(previewText('  hello  world  '), 'hello world');
});

test('previewText: 超长文本截断', () => {
  const long = 'a'.repeat(200);
  assert.ok(previewText(long).endsWith('...'));
});

test('summarizeToolResult: 正常结果包含关键字段', () => {
  const out = summarizeToolResult({ ok: true, action: 'mute', message: 'done' });
  assert.equal(out.ok, true);
  assert.equal(out.action, 'mute');
  assert.equal(out.message, 'done');
});

test('summarizeToolResult: null 返回失败占位', () => {
  assert.deepEqual(summarizeToolResult(null), { ok: false, message: '' });
});

test('summarizeOneBotResult: 正常状态透传', () => {
  const out = summarizeOneBotResult({ status: 'ok' });
  assert.equal(out.status, 'ok');
});

test('summarizeOneBotResult: null 返回未知状态', () => {
  assert.deepEqual(summarizeOneBotResult(null), { status: 'unknown' });
});
