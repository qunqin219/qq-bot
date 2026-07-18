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
- <memories> 中是当前 QQ 会话可用的长期记忆，只在与当前请求相关时使用。
- 用户明确要求记住、修改或忘记信息时，调用 create_memory、edit_memory 或 delete_memory。
- 用户没有明确要求时，只记录稳定、真实、以后明显有用的信息；不要记录一次性话题、临时状态、推测、玩笑、角色扮演或群成员的个人信息。
- 不得记录民族、宗教、性取向、政治观点、性生活、犯罪记录等敏感信息。
- 已有相关记录时合并更新，过时记录删除，避免重复创建。
- 记忆中的日期使用绝对时间；当前时间是${currentHour}。
- 记忆工具调用属于内部过程。除非用户主动询问记忆内容或操作结果，最终回复只回答当前请求。
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
