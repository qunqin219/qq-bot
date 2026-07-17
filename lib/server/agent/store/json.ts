import { randomUUID } from 'node:crypto';
import type {
  AgentApprovalRecord,
  AgentPartRecord,
  AgentRunRecord,
  AgentRunStore,
  AgentSessionRecord,
} from '../types.js';
import { getAgentRuntimeFile } from '../../paths.js';
import { readJsonFile, writeJsonFileAtomic } from '../../json-store.js';

type State = {
  sessions: AgentSessionRecord[];
  runs: AgentRunRecord[];
  parts: AgentPartRecord[];
  approvals: AgentApprovalRecord[];
};

const EMPTY: State = { sessions: [], runs: [], parts: [], approvals: [] };

function now(): string {
  return new Date().toISOString();
}

function read(): State {
  return readJsonFile<State>(getAgentRuntimeFile(), structuredClone(EMPTY), (value): value is State => {
    const item = value as State;
    return Boolean(item && Array.isArray(item.sessions) && Array.isArray(item.runs) && Array.isArray(item.parts) && Array.isArray(item.approvals));
  });
}

function write(state: State): void {
  writeJsonFileAtomic(getAgentRuntimeFile(), state);
}

export const jsonAgentRunStore: AgentRunStore = {
  recoverInterruptedRuns() {
    const state = read();
    let count = 0;
    for (const run of state.runs) {
      if (!['queued', 'running', 'waiting_tool'].includes(run.status)) continue;
      run.status = 'interrupted';
      run.error ||= 'server restarted during run';
      run.updated_at = now();
      run.completed_at = run.updated_at;
      count += 1;
    }
    if (count) write(state);
    return count;
  },
  getOrCreateSession(conversationKey, agent) {
    const state = read();
    const existing = state.sessions.find((item) => item.conversation_key === conversationKey);
    if (existing) {
      if (existing.agent !== agent) {
        existing.agent = agent;
        existing.updated_at = now();
        write(state);
      }
      return existing;
    }
    const timestamp = now();
    const record: AgentSessionRecord = { id: randomUUID(), conversation_key: conversationKey, agent, summary: '', created_at: timestamp, updated_at: timestamp };
    state.sessions.push(record);
    write(state);
    return record;
  },
  updateSessionSummary(sessionId, summary) {
    const state = read();
    const session = state.sessions.find((item) => item.id === sessionId);
    if (!session) return;
    session.summary = summary;
    session.updated_at = now();
    write(state);
  },
  createRun(input) {
    const state = read();
    const timestamp = now();
    const record: AgentRunRecord = { ...input, created_at: timestamp, updated_at: timestamp, completed_at: null };
    state.runs.push(record);
    write(state);
    return record;
  },
  updateRun(runId, patch) {
    const state = read();
    const run = state.runs.find((item) => item.id === runId);
    if (!run) return null;
    Object.assign(run, patch);
    run.updated_at = now();
    if (['completed', 'failed', 'cancelled', 'interrupted'].includes(run.status)) run.completed_at ||= run.updated_at;
    write(state);
    return run;
  },
  getRun(runId) {
    return read().runs.find((item) => item.id === runId) || null;
  },
  listRuns(limit = 50, sessionId) {
    return read().runs.filter((item) => !sessionId || item.session_id === sessionId).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, Math.max(1, Math.min(500, limit)));
  },
  addPart(input) {
    const state = read();
    const record: AgentPartRecord = { ...input, created_at: now(), completed_at: null };
    state.parts.push(record);
    write(state);
    return record;
  },
  completePart(partId, status, content, metadata = {}) {
    const state = read();
    const part = state.parts.find((item) => item.id === partId);
    if (!part) return null;
    part.status = status;
    part.content = content;
    part.metadata = { ...part.metadata, ...metadata };
    part.completed_at = now();
    write(state);
    return part;
  },
  listParts(runId) {
    return read().parts.filter((item) => item.run_id === runId).sort((a, b) => a.created_at.localeCompare(b.created_at));
  },
  createApproval(input) {
    const state = read();
    const record: AgentApprovalRecord = { ...input, status: 'pending', created_at: now(), resolved_at: null };
    state.approvals.push(record);
    write(state);
    return record;
  },
  resolveApproval(id, status) {
    const state = read();
    const approval = state.approvals.find((item) => item.id === id);
    if (!approval) return null;
    approval.status = status;
    approval.resolved_at = now();
    write(state);
    return approval;
  },
  getApproval(id) {
    return read().approvals.find((item) => item.id === id) || null;
  },
  listApprovals(status) {
    const state = read();
    const timestamp = now();
    let changed = false;
    for (const item of state.approvals) {
      if (item.status === 'pending' && item.expires_at <= timestamp) {
        item.status = 'expired';
        item.resolved_at = timestamp;
        changed = true;
      }
    }
    if (changed) write(state);
    return state.approvals.filter((item) => !status || item.status === status).sort((a, b) => b.created_at.localeCompare(a.created_at));
  },
};
