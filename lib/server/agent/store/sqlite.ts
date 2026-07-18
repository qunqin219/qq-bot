import { randomUUID } from 'node:crypto';
import type {
  AgentPartRecord,
  AgentRunRecord,
  AgentRunStore,
  AgentSessionRecord,
} from '../types.js';
import { getDb } from '../../store/sqlite/db.js';

function now(): string {
  return new Date().toISOString();
}

function parseMetadata(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function mapPart(row: Record<string, any>): AgentPartRecord {
  return { ...row, metadata: parseMetadata(row.metadata) } as AgentPartRecord;
}

export const sqliteAgentRunStore: AgentRunStore = {
  recoverInterruptedRuns() {
    const timestamp = now();
    const result = getDb().prepare(`
      UPDATE agent_runs
      SET status = 'interrupted', error = CASE WHEN error = '' THEN 'server restarted during run' ELSE error END,
          updated_at = ?, completed_at = ?
      WHERE status IN ('queued', 'running', 'waiting_tool', 'waiting_approval')
    `).run(timestamp, timestamp);
    return result.changes;
  },

  getOrCreateSession(conversationKey, agent) {
    const existing = getDb().prepare('SELECT * FROM agent_sessions WHERE conversation_key = ?').get(conversationKey) as AgentSessionRecord | undefined;
    if (existing) {
      if (existing.agent !== agent) {
        getDb().prepare('UPDATE agent_sessions SET agent = ?, updated_at = ? WHERE id = ?').run(agent, now(), existing.id);
        existing.agent = agent;
      }
      return existing;
    }
    const timestamp = now();
    const record: AgentSessionRecord = {
      id: randomUUID(),
      conversation_key: conversationKey,
      agent,
      summary: '',
      created_at: timestamp,
      updated_at: timestamp,
    };
    getDb().prepare(`
      INSERT INTO agent_sessions (id, conversation_key, agent, summary, created_at, updated_at)
      VALUES (@id, @conversation_key, @agent, @summary, @created_at, @updated_at)
    `).run(record);
    return record;
  },

  updateSessionSummary(sessionId, summary) {
    getDb().prepare('UPDATE agent_sessions SET summary = ?, updated_at = ? WHERE id = ?').run(summary, now(), sessionId);
  },

  createRun(input) {
    const timestamp = now();
    const record: AgentRunRecord = { ...input, created_at: timestamp, updated_at: timestamp, completed_at: null };
    getDb().prepare(`
      INSERT INTO agent_runs
      (id, session_id, agent, provider, model, status, step, input, output, error, created_at, updated_at, completed_at)
      VALUES (@id, @session_id, @agent, @provider, @model, @status, @step, @input, @output, @error, @created_at, @updated_at, @completed_at)
    `).run(record);
    return record;
  },

  updateRun(runId, patch) {
    const existing = this.getRun(runId);
    if (!existing) return null;
    const status = patch.status ?? existing.status;
    const completed = ['completed', 'failed', 'cancelled', 'interrupted'].includes(status);
    const record: AgentRunRecord = {
      ...existing,
      ...patch,
      updated_at: now(),
      completed_at: completed ? (existing.completed_at || now()) : existing.completed_at,
    };
    getDb().prepare(`
      UPDATE agent_runs SET status=@status, step=@step, output=@output, error=@error,
        updated_at=@updated_at, completed_at=@completed_at WHERE id=@id
    `).run(record);
    return record;
  },

  getRun(runId) {
    return (getDb().prepare('SELECT * FROM agent_runs WHERE id = ?').get(runId) as AgentRunRecord | undefined) || null;
  },

  listRuns(limit = 50, sessionId) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 50));
    if (sessionId) {
      return getDb().prepare('SELECT * FROM agent_runs WHERE session_id = ? ORDER BY created_at DESC LIMIT ?').all(sessionId, safeLimit) as AgentRunRecord[];
    }
    return getDb().prepare('SELECT * FROM agent_runs ORDER BY created_at DESC LIMIT ?').all(safeLimit) as AgentRunRecord[];
  },

  addPart(input) {
    const record: AgentPartRecord = { ...input, created_at: now(), completed_at: null };
    getDb().prepare(`
      INSERT INTO agent_parts
      (id, run_id, session_id, type, status, tool_name, content, metadata, created_at, completed_at)
      VALUES (@id, @run_id, @session_id, @type, @status, @tool_name, @content, @metadata, @created_at, @completed_at)
    `).run({ ...record, metadata: JSON.stringify(record.metadata || {}) });
    return record;
  },

  completePart(partId, status, content, metadata = {}) {
    const row = getDb().prepare('SELECT * FROM agent_parts WHERE id = ?').get(partId) as Record<string, any> | undefined;
    if (!row) return null;
    const mergedMetadata = { ...parseMetadata(row.metadata), ...metadata };
    const completedAt = now();
    getDb().prepare(`
      UPDATE agent_parts SET status = ?, content = ?, metadata = ?, completed_at = ? WHERE id = ?
    `).run(status, content, JSON.stringify(mergedMetadata), completedAt, partId);
    return mapPart({ ...row, status, content, metadata: mergedMetadata, completed_at: completedAt });
  },

  listParts(runId) {
    const rows = getDb().prepare('SELECT * FROM agent_parts WHERE run_id = ? ORDER BY created_at ASC').all(runId) as Array<Record<string, any>>;
    return rows.map(mapPart);
  },
};
