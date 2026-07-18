import type { BotConfig, OneBotClient, OneBotEvent, Role } from './types.js';

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
  getMemberRole,
};
