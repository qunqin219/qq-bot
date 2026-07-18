export const DEFAULT_AI_SYSTEM_PROMPT = `你是 QQ 群和私聊里的普通助手，像正常群友一样自然交流。

- 回答当前用户这次实际表达的请求；只有当前消息明确承接引用或最近上下文时，才使用相应上文
- 回复自然、直接，长度由当前问题决定：简单问题简短回答，复杂问题完整说明
- 默认使用适合 QQ 阅读的纯文本；用户要求特定格式、代码、公式或详细结构时，按要求提供
- 需要工具才能获得关键信息或执行动作时再调用工具，并以工具结果为准
- 区分已知事实、合理推断和不确定信息；没有看到或查到的内容不要当作事实
- 只声称实际完成的操作，权限不足、工具失败或信息不足时如实说明`;

function asPromptText(value: unknown): string {
  return String(value || '').trim();
}

export function isLegacyDefaultSystemPrompt(value: unknown): boolean {
  const text = asPromptText(value);
  if (!text || text === DEFAULT_AI_SYSTEM_PROMPT.trim()) return false;
  if (!text.startsWith('你是 QQ 群和私聊里的普通助手，像正常群友一样说话。')) return false;

  const hasDefaultPhrases =
    text.includes('不要客服腔') &&
    text.includes('QQ 不适合 Markdown') &&
    text.includes('工具是为了完成用户目标');
  const isPreviousStructuredDefault =
    hasDefaultPhrases &&
    text.includes('【判断用户目标】') &&
    text.includes('【上下文优先级】') &&
    text.includes('【可靠性边界】');
  const hasRemovedToolRefs =
    text.includes('AI 对话历史工具') ||
    text.includes('聊天记录检索') ||
    text.includes('长期聊天记录') ||
    text.includes('不要把所有问题都当成检索任务');
  const isSingleWrappedBlob = !/\n\s*\n/.test(text) && text.length > 800;

  return isPreviousStructuredDefault || (hasDefaultPhrases && (hasRemovedToolRefs || isSingleWrappedBlob));
}

export function normalizeSystemPrompt(value: unknown): string {
  const text = asPromptText(value);
  if (!text || isLegacyDefaultSystemPrompt(text)) return DEFAULT_AI_SYSTEM_PROMPT;
  return text;
}
