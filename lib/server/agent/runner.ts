import { randomUUID } from 'node:crypto';
import type { BotConfig, OneBotClient, OneBotEvent } from '../bot/types.js';
import { INTERNAL_INLINE_PARTS_FIELD, type ToolProgressUpdate } from '../ai/types.js';
import type { AgentContext, AgentPartRecord, AgentProgressUpdate, AgentRunRecord } from './types.js';
import * as ai from '../ai.js';
import { buildAiRuntimePreview } from '../bot/context/preview.js';
import { conversationStore } from '../store/index.js';
import { getMemberRole } from '../bot/permissions.js';
import { selectAgent } from './agents.js';
import { qqToolRegistry } from './tools.js';
import { agentRunStore } from './store/index.js';
import { agentEventBus } from './events.js';
import { applyContextBudget } from './context/budget.js';
import { startRunController, finishRunController } from './run-controller.js';

export type AgentRuntimeOverride = {
  conversationKey: string;
  history: Array<{ role: 'user' | 'model'; text: string }>;
  aiInput: string;
  extraSystemInstruction?: string;
  groupInlineImageParts?: Array<Record<string, unknown>>;
  contextTurns?: number;
};

export type AgentTurnInput = {
  event: OneBotEvent;
  client: OneBotClient;
  cfg: BotConfig;
  cleanMsg: string;
  requesterIsAdmin: boolean;
  runtime?: AgentRuntimeOverride;
  onProgress?: (update: AgentProgressUpdate) => Promise<void> | void;
};

export type AgentTurnResult = {
  reply: string | null;
  run: AgentRunRecord;
  sessionId: string;
  agent: string;
  conversationKey: string;
  contextTurns: number;
  finalProviderTurn: Record<string, any> | null;
};

let recovered = false;

const MAX_VISIBLE_PROGRESS_MESSAGES = 2;
const SILENT_PROGRESS_TOOLS = new Set(['create_memory', 'edit_memory', 'delete_memory']);

function ensureRecovery(): void {
  if (recovered) return;
  recovered = true;
  const count = agentRunStore.recoverInterruptedRuns();
  if (count) console.warn(`[Agent] 已将 ${count} 个未完成运行标记为 interrupted`);
}

function persistable(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return { value: String(value ?? '') };
  const safeValue = { ...(value as Record<string, unknown>) };
  delete safeValue[INTERNAL_INLINE_PARTS_FIELD];
  return structuredClone(safeValue);
}

function textForStore(value: unknown, max = 12_000): string {
  const text = typeof value === 'string' ? value : JSON.stringify(persistable(value));
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function visibleProgressText(update: ToolProgressUpdate): string {
  const visibleTools = update.toolNames.filter((name) => !SILENT_PROGRESS_TOOLS.has(name));
  if (visibleTools.length === 0) return '';

  let text = String(update.text || '')
    .replace(/^引用消息ID[:：]\s*\d+\s*/i, '')
    .replace(/\[CQ:[^\]]+\]/gi, '')
    .replace(/https?:\/\/\S+/gi, '')
    .trim();
  text = text.split(/\n{2,}/, 1)[0].replace(/\s+/g, ' ').trim();
  if (!text || text.length > 180) return '';
  if (/```|\{\s*"|\b(?:web_search|web_fetch|qq_[a-z_]+|create_memory|edit_memory|delete_memory)\b/i.test(text)) return '';
  return text;
}

export async function runAgentTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
  ensureRecovery();
  const { event, client, cfg, cleanMsg, requesterIsAdmin } = input;
  const conversationKey = input.runtime?.conversationKey || conversationStore.getConversationKey(event);
  const botRole = event.group_id ? await getMemberRole(client, event.group_id, event.self_id) : 'none';
  const agent = selectAgent({ text: cleanMsg, groupId: event.group_id, requesterIsAdmin });
  const session = agentRunStore.getOrCreateSession(conversationKey, agent.name);
  const runId = randomUUID();
  let run = agentRunStore.createRun({
    id: runId,
    session_id: session.id,
    agent: agent.name,
    provider: String(cfg.ai_provider || 'gemini'),
    model: String(cfg.ai_model || ''),
    status: 'queued',
    step: 0,
    input: cleanMsg,
    output: '',
    error: '',
  });
  agentRunStore.addPart({
    id: randomUUID(), run_id: runId, session_id: session.id, type: 'input', status: 'completed',
    tool_name: '', content: cleanMsg, metadata: { message_id: event.message_id ?? null, user_id: event.user_id ?? null, group_id: event.group_id ?? null },
  });
  run = agentRunStore.updateRun(runId, { status: 'running' }) || run;
  agentEventBus.emit({ type: 'run.started', run });

  const signal = startRunController(runId, Number(cfg.agent_run_timeout_ms || 120_000));
  const runtime = input.runtime || await buildAiRuntimePreview({ event, client, cfg });
  const budgeted = applyContextBudget(runtime.history, {
    totalTokens: Math.max(4_000, Number(cfg.agent_context_token_budget || 24_000)),
    reserveOutputTokens: Math.max(1_000, Number(cfg.agent_output_token_reserve || 4_096)),
    recentTurns: Math.max(2, Number(cfg.agent_recent_turns || 8)),
    previousSummary: session.summary,
  });
  if (budgeted.omitted > 0) {
    agentRunStore.updateSessionSummary(session.id, budgeted.summary);
    const part = agentRunStore.addPart({
      id: randomUUID(), run_id: runId, session_id: session.id, type: 'compaction', status: 'completed',
      tool_name: '', content: budgeted.summary, metadata: { omitted_messages: budgeted.omitted, estimated_tokens: budgeted.estimatedTokens },
    });
    agentEventBus.emit({ type: 'context.compacted', runId, omitted: budgeted.omitted, summary: part.content });
  }

  const baseContext: Omit<AgentContext, 'runId' | 'sessionId' | 'signal'> = {
    event, client, cfg, conversationKey, agent, botRole, requesterIsAdmin,
  };
  const functionDeclarations = qqToolRegistry.declarations(baseContext);
  let finalProviderTurn: Record<string, any> | null = null;
  let visibleProgressCount = 0;
  const visibleProgressTexts = new Set<string>();

  const emitVisibleProgress = async (update: ToolProgressUpdate): Promise<void> => {
    if (!input.onProgress || visibleProgressCount >= MAX_VISIBLE_PROGRESS_MESSAGES) return;
    const text = visibleProgressText(update);
    const key = text.toLowerCase();
    if (!text || visibleProgressTexts.has(key)) return;

    const index = visibleProgressCount + 1;
    const progress: AgentProgressUpdate = {
      runId,
      index,
      text,
      round: update.round,
      source: update.source,
      toolNames: [...update.toolNames],
    };
    try {
      await input.onProgress(progress);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[Agent] 过程消息发送失败 run=${runId} index=${index}: ${message}`);
      agentRunStore.addPart({
        id: randomUUID(), run_id: runId, session_id: session.id, type: 'progress', status: 'failed',
        tool_name: '', content: text, metadata: { round: update.round, source: update.source, tool_names: update.toolNames, error: message },
      });
      return;
    }

    visibleProgressCount = index;
    visibleProgressTexts.add(key);
    agentRunStore.addPart({
      id: randomUUID(), run_id: runId, session_id: session.id, type: 'progress', status: 'completed',
      tool_name: '', content: text, metadata: { index, round: update.round, source: update.source, tool_names: update.toolNames },
    });
    agentEventBus.emit({ type: 'progress.sent', runId, index, text, round: update.round, source: update.source });
  };

  try {
    const reply = await ai.chat(runtime.aiInput, budgeted.history, cfg, {
      functionDeclarations,
      extraSystemInstruction: [runtime.extraSystemInstruction, agent.systemPrompt].filter(Boolean).join('\n\n'),
      autoAttachImages: !event.group_id || (runtime.groupInlineImageParts?.length || 0) === 0,
      extraParts: runtime.groupInlineImageParts || [],
      maxToolRounds: Math.max(1, Math.min(8, agent.maxSteps)),
      maxToolCalls: Math.max(1, Math.min(20, Number(cfg.agent_max_tool_calls || 8))),
      signal,
      onProgress: emitVisibleProgress,
      onFinalTurn: (turn: Record<string, any>) => { finalProviderTurn = turn; },
      onBuiltinToolCalls: (calls, meta) => {
        for (const call of calls) {
          const part = agentRunStore.addPart({
            id: randomUUID(), run_id: runId, session_id: session.id, type: 'tool_call', status: call.status,
            tool_name: call.name, content: textForStore(call.input), metadata: {
              round: meta.round,
              builtin: true,
              provider: String(cfg.ai_provider || ''),
              provider_call_id: call.callId || '',
            },
          });
          agentRunStore.addPart({
            id: randomUUID(), run_id: runId, session_id: session.id, type: 'tool_result', status: call.status,
            tool_name: call.name, content: textForStore(call.output), metadata: {
              tool_call_id: part.id,
              builtin: true,
              provider: String(cfg.ai_provider || ''),
            },
          });
          agentEventBus.emit({ type: 'tool.completed', runId, toolCallId: part.id, tool: call.name, result: call.output });
        }
      },
      executeFunctionCall: async (name, args, meta = { round: 1, index: 1, executedToolCalls: 1 }) => {
        const part: AgentPartRecord = agentRunStore.addPart({
          id: randomUUID(), run_id: runId, session_id: session.id, type: 'tool_call', status: 'pending',
          tool_name: name, content: textForStore(args), metadata: meta,
        });
        agentRunStore.updateRun(runId, { status: 'waiting_tool', step: meta.executedToolCalls });
        agentEventBus.emit({ type: 'tool.requested', runId, part });
        agentEventBus.emit({ type: 'tool.started', runId, toolCallId: part.id, tool: name });
        try {
          const result = await qqToolRegistry.execute(name, args, {
            ...baseContext,
            runId,
            sessionId: session.id,
            signal,
            round: meta.round,
            index: meta.index,
            executedToolCalls: meta.executedToolCalls,
          });
          agentRunStore.completePart(part.id, 'completed', textForStore(result), { result: persistable(result) });
          agentRunStore.addPart({
            id: randomUUID(), run_id: runId, session_id: session.id, type: 'tool_result', status: 'completed',
            tool_name: name, content: textForStore(result), metadata: { tool_call_id: part.id },
          });
          agentRunStore.updateRun(runId, { status: 'running', step: meta.executedToolCalls });
          agentEventBus.emit({ type: 'tool.completed', runId, toolCallId: part.id, tool: name, result });
          return result;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          agentRunStore.completePart(part.id, 'failed', message);
          throw error;
        }
      },
    });

    if (reply) {
      agentRunStore.addPart({ id: randomUUID(), run_id: runId, session_id: session.id, type: 'output', status: 'completed', tool_name: '', content: reply, metadata: {} });
    }
    run = agentRunStore.updateRun(runId, {
      status: reply ? 'completed' : 'failed',
      output: reply || '',
      error: reply ? '' : 'model returned no reply',
    }) || run;
    if (reply) {
      agentEventBus.emit({ type: 'run.completed', runId, output: reply });
    } else {
      agentEventBus.emit({ type: 'run.failed', runId, error: run.error });
    }
    return { reply, run, sessionId: session.id, agent: agent.name, conversationKey, contextTurns: runtime.contextTurns || 10, finalProviderTurn };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cancelled = signal.aborted;
    agentRunStore.updateRun(runId, { status: cancelled ? 'cancelled' : 'failed', error: message });
    agentRunStore.addPart({ id: randomUUID(), run_id: runId, session_id: session.id, type: 'error', status: 'completed', tool_name: '', content: message, metadata: {} });
    if (cancelled) agentEventBus.emit({ type: 'run.cancelled', runId, reason: message });
    else agentEventBus.emit({ type: 'run.failed', runId, error: message });
    throw error;
  } finally {
    finishRunController(runId);
  }
}
