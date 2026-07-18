import type { AgentContext, AgentTool, ToolExecutionContext } from './types.js';
import { INTERNAL_INLINE_PARTS_FIELD } from '../ai/types.js';
import { buildGroupManagementFunctionDeclarations } from '../bot/tools/declarations.js';
import { executeGroupManagementTool } from '../bot/tools/management.js';
import { executeWebFetch } from './web-fetch.js';

const MEMORY_TOOLS = new Set(['create_memory', 'edit_memory', 'delete_memory']);
const GROUP_MANAGEMENT_TOOLS = new Set([
  'qq_set_group_whole_ban',
  'qq_mute_all_manageable_members',
  'qq_unmute_all_manageable_members',
  'qq_mute_member',
  'qq_unmute_member',
  'qq_kick_member',
]);

function isStateChangingGroupManagementTool(name: string): boolean {
  return GROUP_MANAGEMENT_TOOLS.has(name);
}
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
  if (GROUP_MANAGEMENT_TOOLS.has(name)) {
    return Boolean(context.event.group_id && context.requesterIsAdmin && ['owner', 'admin'].includes(context.botRole));
  }
  return false;
}

function createTool(name: string): AgentTool {
  const declaration = declarationFor(name);
  return {
    name,
    description: String(declaration.description || name),
    inputSchema: declaration.parameters || { type: 'object', properties: {} },
    scopes: (MEMORY_TOOLS.has(name) || name === 'web_fetch') ? ['private', 'group'] : ['group'],
    isAvailable: (context) => available(name, context),
    execute: async (input, context) => {
      if (name === 'web_fetch') return executeWebFetch(input, context.signal);
      return (await executeGroupManagementTool(name, input, {
        event: context.event,
        client: context.client,
        cfg: context.cfg,
        botRole: context.botRole,
        requesterIsAdmin: context.requesterIsAdmin,
      })) || { ok: false, message: `工具 ${name} 没有返回结果` };
    },
  };
}

function limitToolResult(result: Record<string, unknown>, maxChars: number): Record<string, unknown> {
  // 图片是 Provider 消费的内部二进制载荷，不是要展示给模型的普通工具文本。
  // 必须先从长度限制流程中分离，否则大图片会让整份结果退化成 preview，
  // 导致后续视觉请求只拿到一截 Base64 文本而不是原图。
  const inlineParts = Array.isArray(result[INTERNAL_INLINE_PARTS_FIELD])
    ? result[INTERNAL_INLINE_PARTS_FIELD]
    : null;
  const publicResult: Record<string, unknown> = { ...result };
  delete publicResult[INTERNAL_INLINE_PARTS_FIELD];

  const attachInlineParts = (value: Record<string, unknown>): Record<string, unknown> => (
    inlineParts
      ? { ...value, [INTERNAL_INLINE_PARTS_FIELD]: inlineParts }
      : value
  );

  const text = JSON.stringify(publicResult);
  if (text.length <= maxChars) return attachInlineParts(publicResult);
  const compact: Record<string, unknown> = { ...publicResult, truncated: true };
  for (const [key, value] of Object.entries(compact)) {
    if (Array.isArray(value) && value.length > 50) compact[key] = value.slice(0, 50);
    if (typeof value === 'string' && value.length > 4000) compact[key] = `${value.slice(0, 4000)}…`;
  }
  const compactText = JSON.stringify(compact);
  if (compactText.length <= maxChars) return attachInlineParts(compact);
  return attachInlineParts({
    ok: result.ok === true,
    truncated: true,
    message: String(result.message || '工具结果过长，已截断'),
    preview: compactText.slice(0, maxChars),
  });
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

    const result = await executeWithTimeout(tool, args, context);
    if (context.signal.aborted) throw context.signal.reason || new Error('agent run cancelled');
    return result;
  }
}

export const qqToolRegistry = new ToolRegistry();
for (const declaration of declarations) qqToolRegistry.register(createTool(String(declaration.name)));

export { isStateChangingGroupManagementTool, limitToolResult };
