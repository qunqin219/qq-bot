import type { AgentDefinition } from './types.js';

const assistant: AgentDefinition = {
  name: 'assistant',
  description: '默认 QQ 助手，负责聊天、图片理解、记忆和只读查询。',
  mode: 'primary',
  systemPrompt: '你是当前 QQ 会话的主助手。优先直接解决用户问题；只有确有必要时才调用工具。',
  tools: ['*'],
  permissions: {},
  maxSteps: 8,
};

const groupManager: AgentDefinition = {
  name: 'group-manager',
  description: '执行群成员查询与群管理任务；写操作必须经过确定性的权限策略。',
  mode: 'primary',
  systemPrompt: [
    '你负责当前 QQ 群的管理任务。',
    '先确认目标、动作和时长，再选择最小范围的工具。',
    '不要声称操作成功，除非工具结果明确返回 ok=true。',
  ].join('\n'),
  tools: ['qq_get_group_members', 'qq_set_group_whole_ban', 'qq_mute_all_manageable_members', 'qq_unmute_all_manageable_members', 'qq_mute_member', 'qq_unmute_member', 'qq_kick_member'],
  permissions: {
    qq_get_group_members: 'allow',
    qq_set_group_whole_ban: 'ask',
    qq_mute_all_manageable_members: 'ask',
    qq_unmute_all_manageable_members: 'ask',
    qq_mute_member: 'ask',
    qq_unmute_member: 'ask',
    qq_kick_member: 'ask',
  },
  maxSteps: 6,
};

const summarizer: AgentDefinition = {
  name: 'summarizer',
  description: '只负责压缩旧会话，不允许调用外部工具。',
  mode: 'subagent',
  systemPrompt: '只保留事实、决定、未完成事项和稳定偏好，不添加新信息。',
  tools: [],
  permissions: { '*': 'deny' },
  maxSteps: 1,
};

const definitions = new Map<string, AgentDefinition>([
  [assistant.name, assistant],
  [groupManager.name, groupManager],
  [summarizer.name, summarizer],
]);

const MANAGEMENT_INTENT = /(?:禁言|解禁|解除禁言|全员禁言|踢出|踢人|移出群|群成员|成员列表)/;

export function getAgent(name: string): AgentDefinition | null {
  return definitions.get(name) || null;
}

export function listAgents(): AgentDefinition[] {
  return [...definitions.values()];
}

export function selectAgent(input: { text: string; groupId?: number | string | null; requesterIsAdmin: boolean }): AgentDefinition {
  if (input.groupId && input.requesterIsAdmin && MANAGEMENT_INTENT.test(input.text)) return groupManager;
  return assistant;
}

export { assistant, groupManager, summarizer };
