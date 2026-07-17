import type { AgentContext, AgentTool, PermissionAction } from './types.js';
import { hasExplicitManagementConfirmation } from '../bot/permissions.js';

function normalizeAction(value: unknown): PermissionAction | null {
  return value === 'allow' || value === 'ask' || value === 'deny' ? value : null;
}

function matchConfiguredPermission(context: AgentContext, toolName: string): PermissionAction | null {
  const configured = context.cfg.agent_tool_permissions;
  if (!configured || typeof configured !== 'object' || Array.isArray(configured)) return null;
  const groupRules = context.event.group_id
    ? (configured as Record<string, any>)[`group:${context.event.group_id}`]
    : null;
  if (groupRules && typeof groupRules === 'object') {
    const exact = normalizeAction(groupRules[toolName]);
    if (exact) return exact;
    const wildcard = normalizeAction(groupRules['*']);
    if (wildcard) return wildcard;
  }
  return normalizeAction((configured as Record<string, any>)[toolName])
    || normalizeAction((configured as Record<string, any>)['*']);
}

export function resolveToolPermission(context: AgentContext, tool: AgentTool): PermissionAction {
  return matchConfiguredPermission(context, tool.name)
    || normalizeAction(context.agent.permissions[tool.name])
    || normalizeAction(context.agent.permissions['*'])
    || tool.defaultPermission;
}

export function hasInlineApproval(context: AgentContext): boolean {
  return hasExplicitManagementConfirmation(context.event.raw_message || '');
}
