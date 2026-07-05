import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canManageRole, roleLabel, adminSet, isConfiguredAdmin, isGroupWithinConfiguredScope, shouldPersistIncomingMessage, isMutatingGroupManagementTool, hasExplicitManagementConfirmation } from '../../lib/server/bot/permissions.js';

test('canManageRole: owner 可管理 admin', () => {
  assert.equal(canManageRole('owner', 'admin'), true);
});

test('canManageRole: admin 不可管理 admin', () => {
  assert.equal(canManageRole('admin', 'admin'), false);
});

test('canManageRole: admin 不可管理 owner', () => {
  assert.equal(canManageRole('admin', 'owner'), false);
});

test('canManageRole: member 不可管理 member', () => {
  assert.equal(canManageRole('member', 'member'), false);
});

test('canManageRole: owner 可管理 member', () => {
  assert.equal(canManageRole('owner', 'member'), true);
});

test('roleLabel: owner -> 群主', () => {
  assert.equal(roleLabel('owner'), '群主');
});

test('roleLabel: admin -> 管理员', () => {
  assert.equal(roleLabel('admin'), '管理员');
});

test('roleLabel: member -> 普通群员', () => {
  assert.equal(roleLabel('member'), '普通群员');
});

test('roleLabel: unknown -> 未知', () => {
  assert.equal(roleLabel('unknown'), '未知');
});

test('adminSet: 数字与字符串混合转为数字 Set', () => {
  const set = adminSet({ admins: [111, '222'] } as any);
  assert.ok(set.has(111));
  assert.ok(set.has(222));
  assert.equal(set.size, 2);
});

test('adminSet: 空数组返回空 Set', () => {
  const set = adminSet({ admins: [] } as any);
  assert.equal(set.size, 0);
});

test('adminSet: 缺失字段视为空', () => {
  const set = adminSet({} as any);
  assert.equal(set.size, 0);
});

test('isConfiguredAdmin: 命中配置的管理员', () => {
  assert.equal(isConfiguredAdmin({ admins: [111] } as any, 111), true);
});

test('isConfiguredAdmin: 未配置的用户返回 false', () => {
  assert.equal(isConfiguredAdmin({ admins: [111] } as any, 999), false);
});

test('isConfiguredAdmin: 字符串 ID 也能命中', () => {
  assert.equal(isConfiguredAdmin({ admins: [111] } as any, '111'), true);
});

test('isGroupWithinConfiguredScope: 未启用过滤时恒为 true', () => {
  assert.equal(isGroupWithinConfiguredScope({ group_filter_enabled: false } as any, 999), true);
});

test('isGroupWithinConfiguredScope: 启用过滤且群在白名单内为 true', () => {
  assert.equal(isGroupWithinConfiguredScope({ group_filter_enabled: true, active_groups: [100] } as any, 100), true);
});

test('isGroupWithinConfiguredScope: 启用过滤但群不在白名单为 false', () => {
  assert.equal(isGroupWithinConfiguredScope({ group_filter_enabled: true, active_groups: [100] } as any, 999), false);
});

test('shouldPersistIncomingMessage: bot 自身消息不持久化', () => {
  assert.equal(shouldPersistIncomingMessage({ user_id: 100, self_id: 100, group_id: 5 } as any, {} as any, true), false);
});

test('shouldPersistIncomingMessage: 非 admin 私聊不持久化', () => {
  assert.equal(shouldPersistIncomingMessage({ user_id: 1, self_id: 100, group_id: null } as any, {} as any, false), false);
});

test('shouldPersistIncomingMessage: 群消息持久化', () => {
  assert.equal(shouldPersistIncomingMessage({ user_id: 1, self_id: 100, group_id: 5 } as any, {} as any, false), true);
});

test('isMutatingGroupManagementTool: qq_mute_member 为变更类', () => {
  assert.equal(isMutatingGroupManagementTool('qq_mute_member'), true);
});

test('isMutatingGroupManagementTool: qq_get_group_members 非变更类', () => {
  assert.equal(isMutatingGroupManagementTool('qq_get_group_members'), false);
});

test('isMutatingGroupManagementTool: qq_read_image 非变更类', () => {
  assert.equal(isMutatingGroupManagementTool('qq_read_image'), false);
});

test('hasExplicitManagementConfirmation: 确认禁言', () => {
  assert.equal(hasExplicitManagementConfirmation('确认禁言'), true);
});

test('hasExplicitManagementConfirmation: 请禁言 不算确认', () => {
  assert.equal(hasExplicitManagementConfirmation('请禁言'), false);
});

test('hasExplicitManagementConfirmation: 确认执行', () => {
  assert.equal(hasExplicitManagementConfirmation('确认执行'), true);
});

test('hasExplicitManagementConfirmation: 确认全员禁言', () => {
  assert.equal(hasExplicitManagementConfirmation('确认全员禁言'), true);
});

