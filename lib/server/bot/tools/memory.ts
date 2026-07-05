import type { BotConfig, ToolArgs } from '../types.js';

import { memoryStore } from '../../store/index.js';
import { getCurrentHourText } from '../utils.js';

function buildMemorySystemPrompt(conversationKey: string): string {
  const mems = memoryStore.getForConversation(conversationKey);
  const currentHour = getCurrentHourText();
  const lines = [
    '## Memories',
    'These are memories that you can reference in the future conversations.',
    '<memories>',
  ];
  for (const m of mems) {
    lines.push('<record>');
    lines.push(`<id>${m.id}</id>`);
    lines.push(`<content>${m.content}</content>`);
    lines.push('</record>');
  }
  lines.push('</memories>');
  lines.push(`
## Memory Tool
你是一个无状态的大模型，你无法存储记忆，因此为了记住信息，你需要使用**记忆工具**。
你可以使用 \`create_memory\`, \`edit_memory\`, \`delete_memory\` 工具创建、更新或删除记忆。
- 如果记忆中没有相关信息，请使用 create_memory 创建一条新的记录。
- 如果已有相关记录，请使用 edit_memory 更新内容。
- 若记忆过时或无用，请使用 delete_memory 删除。
这些记忆会自动包含在未来的对话上下文中，在<memories>标签内。
请勿在记忆中存储敏感信息，敏感信息包括：用户的民族、宗教信仰、性取向、政治观点及党派归属、性生活、犯罪记录等。
在与用户聊天过程中，你可以像一个私人秘书一样**主动的**记录用户相关的信息到记忆里，包括但不限于：
- 用户昵称/姓名
- 年龄/性别/兴趣爱好
- 计划事项等
- 聊天风格偏好
- 工作相关
- 首次聊天时间
- ...
请主动调用工具记录，而不是需要用户要求。
只记录真实、客观的信息；如果群里在跟你玩梗、玩角色扮演、开玩笑（比如好感度、攻略进度、人设剧情之类的），这些是娱乐互动，不是真实信息，**不要**把这类内容当成事实存进记忆。
记忆如果包含日期信息，请包含在内，请使用绝对时间格式，并且当前时间是${currentHour}。
**绝对不要**在回复中提及记忆操作，例如"已帮你记下来了""我已经记住了""已更新记录"之类的话一律不能说，也不要在对话中直接显示记忆内容，除非用户主动要求查看。记忆工具调用必须完全静默，对用户不可见。
相似或相关的记忆应合并为一条记录，而不要重复记录，过时记录应删除。
你可以在和用户闲聊的时候暗示用户你能记住东西。
`);
  lines.push(`注意：这些记忆只属于当前 QQ 会话 ${conversationKey}，不要跨私聊或其他群聊使用。`);
  return lines.join('\n');
}

function executeMemoryTool(
  name: string,
  args: ToolArgs,
  conversationKey: string,
  cfg: BotConfig
): Record<string, any> | null {
  if (cfg.ai_memory_enabled !== true) {
    return { ok: false, message: '记忆功能未启用' };
  }
  if (name === 'create_memory') {
    const content = String(args?.content || '').trim();
    if (!content) return { ok: false, message: 'Memory content must not be empty.' };
    const memory = memoryStore.add(conversationKey, content);
    return memory
      ? { ok: true, action: 'create_memory', id: memory.id, content: memory.content, message: memory.content }
      : { ok: false, message: '创建记忆失败' };
  }
  if (name === 'edit_memory') {
    const id = Number(args?.id || 0);
    const content = String(args?.content || '').trim();
    if (!id) return { ok: false, message: 'Memory id must be a positive integer.' };
    if (!content) return { ok: false, message: 'Memory content must not be empty.' };
    const memory = memoryStore.update(conversationKey, id, content);
    return memory
      ? { ok: true, action: 'edit_memory', id: memory.id, content: memory.content, message: memory.content }
      : { ok: false, message: `No memory record was found for id ${id}.` };
  }
  if (name === 'delete_memory') {
    const id = Number(args?.id || 0);
    if (!id) return { ok: false, message: 'Memory id must be a positive integer.' };
    const ok = memoryStore.remove(conversationKey, id);
    return ok
      ? { ok: true, action: 'delete_memory', id, message: 'deleted' }
      : { ok: false, message: `No memory record was found for id ${id}.` };
  }
  return null;
}

export { buildMemorySystemPrompt, executeMemoryTool };
