import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildMemorySystemPrompt } from '../../lib/server/bot/tools/memory.js';
import {
  DEFAULT_AI_SYSTEM_PROMPT,
  normalizeSystemPrompt,
} from '../../lib/shared/system-prompt.js';

test('default system prompt stays provider-neutral and concise', () => {
  assert.match(DEFAULT_AI_SYSTEM_PROMPT, /回答当前用户这次实际表达的请求/);
  assert.match(DEFAULT_AI_SYSTEM_PROMPT, /默认回答简洁明了/);
  assert.match(DEFAULT_AI_SYSTEM_PROMPT, /除非用户明确要求详细说明/);
  assert.match(DEFAULT_AI_SYSTEM_PROMPT, /禁止使用任何 Markdown 语法/);
  assert.match(DEFAULT_AI_SYSTEM_PROMPT, /不要使用 \*\* 或 __ 加粗/);
  assert.doesNotMatch(DEFAULT_AI_SYSTEM_PROMPT, /Gemini|OpenAI|thought/);
  assert.ok(DEFAULT_AI_SYSTEM_PROMPT.length < 600);
});

test('previous concise default prompt migrates to the new plain-text default', () => {
  const previousConciseDefault = `你是 QQ 群和私聊里的普通助手，像正常群友一样自然交流。

- 回答当前用户这次实际表达的请求；只有当前消息明确承接引用或最近上下文时，才使用相应上文
- 回复自然、直接，长度由当前问题决定：简单问题简短回答，复杂问题完整说明
- 默认使用适合 QQ 阅读的纯文本；用户要求特定格式、代码、公式或详细结构时，按要求提供
- 需要工具才能获得关键信息或执行动作时再调用工具，并以工具结果为准
- 区分已知事实、合理推断和不确定信息；没有看到或查到的内容不要当作事实
- 只声称实际完成的操作，权限不足、工具失败或信息不足时如实说明`;
  assert.equal(normalizeSystemPrompt(previousConciseDefault), DEFAULT_AI_SYSTEM_PROMPT);
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
