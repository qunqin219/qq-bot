import type { BotConfig, OneBotClient, OneBotEvent, Role } from '../bot/types.js';

export type AgentMode = 'primary' | 'subagent';
export type PermissionAction = 'allow' | 'ask' | 'deny';
export type ToolRisk = 'read' | 'write' | 'destructive';
export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'waiting_tool'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export type AgentPartType =
  | 'input'
  | 'output'
  | 'tool_call'
  | 'tool_result'
  | 'progress'
  | 'approval'
  | 'compaction'
  | 'error';

export type AgentDefinition = {
  name: string;
  description: string;
  mode: AgentMode;
  systemPrompt: string;
  tools: string[];
  permissions: Record<string, PermissionAction>;
  maxSteps: number;
};

export type AgentContext = {
  event: OneBotEvent;
  client: OneBotClient;
  cfg: BotConfig;
  conversationKey: string;
  sessionId: string;
  runId: string;
  agent: AgentDefinition;
  botRole: Role;
  requesterIsAdmin: boolean;
  signal: AbortSignal;
};

export type ToolExecutionContext = AgentContext & {
  round: number;
  index: number;
  executedToolCalls: number;
};

export type AgentTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  risk: ToolRisk;
  scopes: Array<'private' | 'group'>;
  defaultPermission: PermissionAction;
  isAvailable(context: Omit<AgentContext, 'runId' | 'sessionId' | 'signal'>): boolean;
  execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<Record<string, unknown>>;
};

export type AgentSessionRecord = {
  id: string;
  conversation_key: string;
  agent: string;
  summary: string;
  created_at: string;
  updated_at: string;
};

export type AgentRunRecord = {
  id: string;
  session_id: string;
  agent: string;
  provider: string;
  model: string;
  status: AgentRunStatus;
  step: number;
  input: string;
  output: string;
  error: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type AgentPartRecord = {
  id: string;
  run_id: string;
  session_id: string;
  type: AgentPartType;
  status: string;
  tool_name: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
  completed_at: string | null;
};

export type AgentProgressUpdate = {
  runId: string;
  index: number;
  text: string;
  round: number;
  source: 'model' | 'builtin_tool';
  toolNames: string[];
};

export type AgentApprovalRecord = {
  id: string;
  run_id: string;
  session_id: string;
  tool_name: string;
  args: Record<string, unknown>;
  requester_id: string;
  group_id: string;
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'consumed';
  expires_at: string;
  created_at: string;
  resolved_at: string | null;
};

export type AgentEvent =
  | { type: 'run.started'; run: AgentRunRecord }
  | { type: 'run.status'; runId: string; status: AgentRunStatus; step: number }
  | { type: 'context.compacted'; runId: string; omitted: number; summary: string }
  | { type: 'tool.requested'; runId: string; part: AgentPartRecord }
  | { type: 'tool.started'; runId: string; toolCallId: string; tool: string }
  | { type: 'tool.completed'; runId: string; toolCallId: string; tool: string; result: Record<string, unknown> }
  | { type: 'progress.sent'; runId: string; index: number; text: string; round: number; source: 'model' | 'builtin_tool' }
  | { type: 'approval.requested'; runId: string; approval: AgentApprovalRecord }
  | { type: 'run.completed'; runId: string; output: string }
  | { type: 'run.failed'; runId: string; error: string }
  | { type: 'run.cancelled'; runId: string; reason: string };

export interface AgentRunStore {
  recoverInterruptedRuns(): number;
  getOrCreateSession(conversationKey: string, agent: string): AgentSessionRecord;
  updateSessionSummary(sessionId: string, summary: string): void;
  createRun(input: Omit<AgentRunRecord, 'created_at' | 'updated_at' | 'completed_at'>): AgentRunRecord;
  updateRun(runId: string, patch: Partial<Pick<AgentRunRecord, 'status' | 'step' | 'output' | 'error'>>): AgentRunRecord | null;
  getRun(runId: string): AgentRunRecord | null;
  listRuns(limit?: number, sessionId?: string): AgentRunRecord[];
  addPart(input: Omit<AgentPartRecord, 'created_at' | 'completed_at'>): AgentPartRecord;
  completePart(partId: string, status: string, content: string, metadata?: Record<string, unknown>): AgentPartRecord | null;
  listParts(runId: string): AgentPartRecord[];
  createApproval(input: Omit<AgentApprovalRecord, 'created_at' | 'resolved_at' | 'status'>): AgentApprovalRecord;
  resolveApproval(id: string, status: 'approved' | 'denied' | 'expired' | 'consumed'): AgentApprovalRecord | null;
  getApproval(id: string): AgentApprovalRecord | null;
  listApprovals(status?: AgentApprovalRecord['status']): AgentApprovalRecord[];
}
