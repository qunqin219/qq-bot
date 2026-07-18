import type { AgentDefinition } from './types.js';

const assistant: AgentDefinition = {
  name: 'assistant',
  description: '默认 QQ 助手，负责聊天、图片理解、记忆和只读查询。',
  mode: 'primary',
  systemPrompt: '',
  tools: ['*'],
  permissions: {},
  maxSteps: 8,
};

const groupManager: AgentDefinition = {
  name: 'group-manager',
  description: '执行群成员查询与群管理任务；写操作必须经过确定性的权限策略。',
  mode: 'primary',
  systemPrompt: [
    '当前运行角色是 QQ 群管理助手。',
    '根据当前请求选择群管理工具，并以工具返回结果判断操作是否成功。',
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
