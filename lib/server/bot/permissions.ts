import type { BotConfig, OneBotClient, OneBotEvent, Role } from './types.js';

import * as ai from '../ai.js';

function roleLabel(role: Role): string {
  if (role === 'owner') return '群主';
  if (role === 'admin') return '管理员';
  if (role === 'member') return '普通群员';
  return '未知';
}

function canManageRole(botRole: Role, targetRole: Role): boolean {
  if (!['owner', 'admin'].includes(botRole)) return false;
  if (targetRole === 'owner') return false;
  if (targetRole === 'admin' && botRole !== 'owner') return false;
  return true;
}

function adminSet(cfg: BotConfig): Set<number> {
  return new Set((cfg.admins || []).map(Number).filter(Number.isFinite));
}

function isConfiguredAdmin(cfg: BotConfig, userId: number | string | null | undefined): boolean {
  return adminSet(cfg).has(Number(userId));
}

function isGroupWithinConfiguredScope(cfg: BotConfig, groupId: number | string | null | undefined): boolean {
  if (!groupId) return true;
  if (!cfg.group_filter_enabled) return true;
  const activeGroups = (cfg.active_groups || []).map(Number).filter(Number.isFinite);
  return activeGroups.includes(Number(groupId));
}

function shouldPersistIncomingMessage(event: OneBotEvent, cfg: BotConfig, isAdmin: boolean): boolean {
  if (Number(event.user_id) === Number(event.self_id)) return false;
  if (!isGroupWithinConfiguredScope(cfg, event.group_id)) return false;
  if (!event.group_id) return isAdmin;
  return true;
}

function isMutatingGroupManagementTool(name: string): boolean {
  return [
    'qq_set_group_whole_ban',
    'qq_mute_all_manageable_members',
    'qq_unmute_all_manageable_members',
    'qq_mute_member',
    'qq_unmute_member',
    'qq_kick_member',
  ].includes(name);
}

function hasExplicitManagementConfirmation(raw: unknown): boolean {
  const text = ai.stripCqCodes(raw).trim();
  return /确认(执行|操作|禁言|解禁|解除禁言|踢出|移出|开启全员禁言|关闭全员禁言|全员禁言)/.test(text);
}

async function getMemberRole(
  client: OneBotClient,
  groupId: number | string | null | undefined,
  userId: number | string | null | undefined
): Promise<Role> {
  if (!client?.getGroupMemberInfo || !groupId || !userId) return 'unknown';
  const result = await client.getGroupMemberInfo(groupId, userId, true);
  return result?.status === 'ok' ? (result.data?.role || 'unknown') : 'unknown';
}

export {
  roleLabel,
  canManageRole,
  adminSet,
  isConfiguredAdmin,
  isGroupWithinConfiguredScope,
  shouldPersistIncomingMessage,
  isMutatingGroupManagementTool,
  hasExplicitManagementConfirmation,
  getMemberRole,
};
