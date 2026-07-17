import { randomUUID } from 'node:crypto';
import type { AgentContext, AgentTool, ToolExecutionContext } from './types.js';
import { buildGroupManagementFunctionDeclarations } from '../bot/tools/declarations.js';
import { executeGroupManagementTool } from '../bot/tools/management.js';
import { isMutatingGroupManagementTool } from '../bot/permissions.js';
import { resolveToolPermission, hasInlineApproval } from './permission.js';
import { agentRunStore } from './store/index.js';
import { agentEventBus } from './events.js';
import { executeWebFetch } from './web-fetch.js';

const MEMORY_TOOLS = new Set(['create_memory', 'edit_memory', 'delete_memory']);
const declarations = buildGroupManagementFunctionDeclarations({
  memoryEnabled: true,
  imageReadEnabled: true,
  memberListEnabled: true,
  managementEnabled: true,
});
declarations.push({
  name: 'web_fetch',
  description: '读取一个公开 HTTP(S) URL 的网页正文。适合在已知具体链接时获取页面内容；搜索未知信息时优先使用 OpenAI Web Search。禁止访问本机和内网地址。',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: '要读取的完整公开 http(s) URL' },
    },
    required: ['url'],
  },
});

function declarationFor(name: string): Record<string, any> {
  return declarations.find((item) => item.name === name) || { name, description: name, parameters: { type: 'object', properties: {} } };
}

function available(name: string, context: Omit<AgentContext, 'runId' | 'sessionId' | 'signal'>): boolean {
  if (name === 'web_fetch') return context.cfg.ai_provider === 'openai' && context.cfg.ai_web_fetch_enabled === true;
  if (MEMORY_TOOLS.has(name)) return context.cfg.ai_memory_enabled === true;
  if (name === 'qq_read_image') return Boolean(context.event.group_id && context.cfg.ai_group_context_enabled === true);
  if (name === 'qq_get_group_members') return Boolean(context.event.group_id && context.requesterIsAdmin);
  if (isMutatingGroupManagementTool(name)) {
    return Boolean(context.event.group_id && context.requesterIsAdmin && ['owner', 'admin'].includes(context.botRole));
  }
  return false;
}

function createTool(name: string): AgentTool {
  const declaration = declarationFor(name);
  const mutating = isMutatingGroupManagementTool(name);
  return {
    name,
    description: String(declaration.description || name),
    inputSchema: declaration.parameters || { type: 'object', properties: {} },
    risk: mutating ? 'destructive' : (MEMORY_TOOLS.has(name) ? 'write' : 'read'),
    scopes: (MEMORY_TOOLS.has(name) || name === 'web_fetch') ? ['private', 'group'] : ['group'],
    defaultPermission: mutating ? 'ask' : 'allow',
    isAvailable: (context) => available(name, context),
    execute: async (input, context) => {
      if (name === 'web_fetch') return executeWebFetch(input, context.signal);
      return (await executeGroupManagementTool(name, input, {
        event: context.event,
        client: context.client,
        cfg: context.cfg,
        botRole: context.botRole,
        requesterIsAdmin: context.requesterIsAdmin,
        permissionGranted: true,
      })) || { ok: false, message: `工具 ${name} 没有返回结果` };
    },
  };
}

function limitToolResult(result: Record<string, unknown>, maxChars: number): Record<string, unknown> {
  const text = JSON.stringify(result);
  if (text.length <= maxChars) return result;
  const compact: Record<string, unknown> = { ...result, truncated: true };
  for (const [key, value] of Object.entries(compact)) {
    if (Array.isArray(value) && value.length > 50) compact[key] = value.slice(0, 50);
    if (typeof value === 'string' && value.length > 4000) compact[key] = `${value.slice(0, 4000)}…`;
  }
  const compactText = JSON.stringify(compact);
  if (compactText.length <= maxChars) return compact;
  return {
    ok: result.ok === true,
    truncated: true,
    message: String(result.message || '工具结果过长，已截断'),
    preview: compactText.slice(0, maxChars),
  };
}

async function executeWithTimeout(
  tool: AgentTool,
  args: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<Record<string, unknown>> {
  const timeoutMs = Math.max(1_000, Math.min(120_000, Number(context.cfg.agent_tool_timeout_ms || 30_000)));
  let timer: NodeJS.Timeout | null = null;
  try {
    const result = await Promise.race([
      tool.execute(args, context),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`工具 ${tool.name} 执行超时（${timeoutMs}ms）`)), timeoutMs);
        timer.unref();
      }),
    ]);
    return limitToolResult(result, Math.max(4_000, Number(context.cfg.agent_tool_result_max_chars || 24_000)));
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();

  register(tool: AgentTool): this {
    if (this.tools.has(tool.name)) throw new Error(`duplicate tool: ${tool.name}`);
    this.tools.set(tool.name, tool);
    return this;
  }

  get(name: string): AgentTool | null {
    return this.tools.get(name) || null;
  }

  resolve(context: Omit<AgentContext, 'runId' | 'sessionId' | 'signal'>): AgentTool[] {
    return [...this.tools.values()].filter((tool) => {
      const selected = context.agent.tools.includes('*') || context.agent.tools.includes(tool.name);
      return selected && tool.isAvailable(context);
    });
  }

  declarations(context: Omit<AgentContext, 'runId' | 'sessionId' | 'signal'>): Array<Record<string, unknown>> {
    return this.resolve(context).map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    }));
  }

  async execute(name: string, args: Record<string, unknown>, context: ToolExecutionContext): Promise<Record<string, unknown>> {
    if (context.signal.aborted) throw new Error('agent run cancelled');
    const tool = this.get(name);
    if (!tool || !tool.isAvailable(context)) return { ok: false, message: `工具不可用：${name}` };

    const action = resolveToolPermission(context, tool);
    if (action === 'deny') return { ok: false, denied: true, message: `当前策略禁止执行工具 ${name}` };

    if (action === 'ask' && !hasInlineApproval(context)) {
      const approval = agentRunStore.createApproval({
        id: randomUUID(),
        run_id: context.runId,
        session_id: context.sessionId,
        tool_name: name,
        args,
        requester_id: String(context.event.user_id || ''),
        group_id: String(context.event.group_id || ''),
        expires_at: new Date(Date.now() + Math.max(60_000, Number(context.cfg.agent_approval_ttl_ms || 10 * 60_000))).toISOString(),
      });
      agentRunStore.updateRun(context.runId, { status: 'waiting_approval', step: context.executedToolCalls });
      agentEventBus.emit({ type: 'approval.requested', runId: context.runId, approval });
      return {
        ok: false,
        approval_required: true,
        approval_id: approval.id,
        message: `该操作需要确认。请发送 /approve ${approval.id} 执行，或 /deny ${approval.id} 拒绝。审批 10 分钟内有效。`,
      };
    }

    const result = await executeWithTimeout(tool, args, context);
    if (context.signal.aborted) throw context.signal.reason || new Error('agent run cancelled');
    return result;
  }
}

export const qqToolRegistry = new ToolRegistry();
for (const declaration of declarations) qqToolRegistry.register(createTool(String(declaration.name)));
