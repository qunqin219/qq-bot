import type { BotConfig, GroupManagementContext, OneBotClient, OneBotEvent, Role, ToolArgs } from '../types.js';

import { conversationStore } from '../../store/index.js';
import {
  adminSet,
  canManageRole,
  roleLabel,
  getMemberRole,
} from '../permissions.js';
import { executeMemoryTool } from './memory.js';
import { executeReadImageTool } from './image.js';

async function getManageableMembers(
  client: OneBotClient,
  groupId: number | string,
  cfg: BotConfig,
  event: OneBotEvent,
  botRole: Role
): Promise<Record<string, any>> {
  const result = await client.getGroupMemberList!(groupId);
  if (result?.status !== 'ok' || !Array.isArray(result.data)) {
    return {
      ok: false,
      message: `获取群成员列表失败：${result?.wording || result?.msg || '未知错误'}`,
      members: [],
    };
  }

  const configuredAdmins = adminSet(cfg);
  const members = result.data
    .map((m) => ({
      user_id: Number(m.user_id),
      nickname: m.nickname || '',
      card: m.card || '',
      display_name: m.card || m.nickname || String(m.user_id),
      role: m.role || 'unknown',
    }))
    .filter((m) => m.user_id && m.user_id !== Number(event.self_id))
    .filter((m) => !configuredAdmins.has(m.user_id))
    .filter((m) => canManageRole(botRole, m.role));
  return { ok: true, total_count: result.data.length, members };
}

async function executeGroupManagementTool(
  name: string,
  args: ToolArgs,
  context: GroupManagementContext
): Promise<Record<string, any> | null> {
  const { event, client, cfg, botRole, requesterIsAdmin } = context;
  const groupId = event.group_id;
  const targetUserId = Number(args?.target_user_id || 0);

  if (name === 'create_memory' || name === 'edit_memory' || name === 'delete_memory') {
    const conversationKey = conversationStore.getConversationKey(event);
    return executeMemoryTool(name, args, conversationKey, cfg);
  }

  function deny(message: string): Record<string, any> {
    return { ok: false, message };
  }

  if (!groupId) return deny('这个工具只能在群聊里用');
  if (name === 'qq_read_image') {
    return executeReadImageTool(args, context);
  }
  if (!requesterIsAdmin) return deny('你没有权限让我读取群成员列表或执行群管理操作');

  if (name === 'qq_get_group_members') {
    if (!client?.getGroupMemberList) return deny('当前 OneBot 客户端不支持读取群成员列表');
    const result = await client.getGroupMemberList(groupId);
    if (result?.status !== 'ok' || !Array.isArray(result.data)) {
      return deny(`获取群成员列表失败：${result?.wording || result?.msg || '未知错误'}`);
    }
    const keyword = String(args?.keyword || '').trim().toLowerCase();
    const members = result.data
      .map((m) => ({
        user_id: Number(m.user_id),
        nickname: m.nickname || '',
        card: m.card || '',
        display_name: m.card || m.nickname || String(m.user_id),
        role: m.role || 'unknown',
        title: m.title || '',
      }))
      .filter((m) => !keyword || [
        String(m.user_id),
        m.nickname,
        m.card,
        m.display_name,
        m.title,
      ].some((value) => String(value || '').toLowerCase().includes(keyword)));
    return {
      ok: true,
      action: 'get_group_members',
      group_id: groupId,
      total_count: result.data.length,
      returned_count: members.length,
      members,
      message: keyword
        ? `找到 ${members.length} 个匹配成员`
        : `当前群共有 ${result.data.length} 个成员`,
    };
  }

  if (!['owner', 'admin'].includes(botRole)) {
    return deny(`我在这个群只是${roleLabel(botRole)}，没有群管理权限`);
  }

  if (name === 'qq_set_group_whole_ban') {
    if (!client?.setGroupWholeBan) return deny('当前 OneBot 客户端不支持全员禁言');
    const enable = args?.enable === true;
    const result = await client.setGroupWholeBan(groupId, enable);
    const ok = result?.status === 'ok';
    return {
      ok,
      action: 'whole_ban',
      enable,
      message: ok
        ? (enable ? '已开启全员禁言' : '已关闭全员禁言')
        : `设置全员禁言失败：${result?.wording || result?.msg || '未知错误'}`,
    };
  }

  if (name === 'qq_mute_all_manageable_members' || name === 'qq_unmute_all_manageable_members') {
    const list = await getManageableMembers(client, groupId, cfg, event, botRole);
    if (!list.ok) return deny(list.message);
    const duration = name === 'qq_mute_all_manageable_members'
      ? Math.max(60, Math.min(2592000, Number(args?.duration_seconds || 600)))
      : 0;
    const results: Array<Record<string, any>> = [];
    for (const member of list.members) {
      const result = await client.setGroupBan!(groupId, member.user_id, duration);
      results.push({
        user_id: member.user_id,
        display_name: member.display_name,
        ok: result?.status === 'ok',
        error: result?.status === 'ok' ? '' : (result?.wording || result?.msg || '未知错误'),
      });
    }
    const success = results.filter((item) => item.ok);
    const failed = results.filter((item) => !item.ok);
    return {
      ok: failed.length === 0,
      action: duration > 0 ? 'mute_all_manageable' : 'unmute_all_manageable',
      duration_seconds: duration,
      total_group_members: list.total_count,
      target_count: list.members.length,
      success_count: success.length,
      failed_count: failed.length,
      results,
      message: duration > 0
        ? `已批量禁言 ${success.length}/${list.members.length} 个可操作成员`
        : `已批量解除禁言 ${success.length}/${list.members.length} 个可操作成员`,
    };
  }

  if (!targetUserId) return deny('没找到要操作的目标 QQ');
  if (targetUserId === Number(event.self_id)) return deny('不能操作我自己');
  if (adminSet(cfg).has(targetUserId)) return deny('不能操作配置里的管理员');

  const targetRole = await getMemberRole(client, groupId, targetUserId);
  if (!canManageRole(botRole, targetRole)) {
    return deny(`我目前是${roleLabel(botRole)}，不能操作对方这个身份：${roleLabel(targetRole)}`);
  }

  if (name === 'qq_mute_member') {
    const duration = Math.max(60, Math.min(2592000, Number(args?.duration_seconds || 600)));
    const result = await client.setGroupBan!(groupId, targetUserId, duration);
    const ok = result?.status === 'ok';
    return {
      ok,
      action: 'mute',
      target_user_id: targetUserId,
      duration_seconds: duration,
      message: ok ? `已禁言 ${targetUserId} ${duration} 秒` : `禁言失败：${result?.wording || result?.msg || '未知错误'}`,
    };
  }

  if (name === 'qq_unmute_member') {
    const result = await client.setGroupBan!(groupId, targetUserId, 0);
    const ok = result?.status === 'ok';
    return {
      ok,
      action: 'unmute',
      target_user_id: targetUserId,
      message: ok ? `已解除 ${targetUserId} 的禁言` : `解除禁言失败：${result?.wording || result?.msg || '未知错误'}`,
    };
  }

  if (name === 'qq_kick_member') {
    const reject = args?.reject_add_request === true;
    const result = await client.setGroupKick!(groupId, targetUserId, reject);
    const ok = result?.status === 'ok';
    return {
      ok,
      action: 'kick',
      target_user_id: targetUserId,
      reject_add_request: reject,
      message: ok ? `已移出 ${targetUserId}` : `移出失败：${result?.wording || result?.msg || '未知错误'}`,
    };
  }

  return deny(`未知工具：${name}`);
}

export { executeGroupManagementTool };
