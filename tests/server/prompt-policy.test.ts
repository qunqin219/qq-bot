import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildMemorySystemPrompt } from '../../lib/server/bot/tools/memory.js';
import {
  DEFAULT_AI_SYSTEM_PROMPT,
  normalizeSystemPrompt,
} from '../../lib/shared/system-prompt.js';

test('default system prompt stays provider-neutral and concise', () => {
  assert.match(DEFAULT_AI_SYSTEM_PROMPT, /回答当前用户这次实际表达的请求/);
  assert.match(DEFAULT_AI_SYSTEM_PROMPT, /长度由当前问题决定/);
  assert.doesNotMatch(DEFAULT_AI_SYSTEM_PROMPT, /Gemini|OpenAI|thought|Markdown 链接/);
  assert.ok(DEFAULT_AI_SYSTEM_PROMPT.length < 500);
});

test('previous structured default prompt migrates to the concise default', () => {
  const previousDefault = [
    '你是 QQ 群和私聊里的普通助手，像正常群友一样说话。',
    '【回复风格】',
    '不要客服腔',
    'QQ 不适合 Markdown',
    '【判断用户目标】',
    '【上下文优先级】',
    '工具是为了完成用户目标',
    '【可靠性边界】',
  ].join('\n');
  assert.equal(normalizeSystemPrompt(previousDefault), DEFAULT_AI_SYSTEM_PROMPT);
});

test('memory prompt records only durable useful information without demanding proactive writes', () => {
  const prompt = buildMemorySystemPrompt('prompt-policy-test');
  assert.match(prompt, /只记录稳定、真实、以后明显有用的信息/);
  assert.match(prompt, /用户明确要求记住、修改或忘记信息时/);
  assert.doesNotMatch(prompt, /请主动调用工具记录|像一个私人秘书一样|首次聊天时间/);
});
