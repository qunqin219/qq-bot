import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-bot-agent-runtime-'));
process.env.QQ_BOT_STORE_BACKEND = 'json';
process.env.QQ_BOT_CONVERSATIONS_FILE = path.join(tempRoot, 'conversations.json');
process.env.QQ_BOT_MEMORIES_FILE = path.join(tempRoot, 'memories.json');
process.env.QQ_BOT_AGENT_RUNTIME_FILE = path.join(tempRoot, 'agent-runtime.json');

test('context budget keeps recent turns and compacts older messages', async () => {
  const { applyContextBudget } = await import('../../lib/server/agent/context/budget.js');
  const history = Array.from({ length: 20 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' as const : 'model' as const,
    text: `message-${index} ${'x'.repeat(400)}`,
  }));
  const result = applyContextBudget(history, {
    totalTokens: 1_200,
    reserveOutputTokens: 200,
    recentTurns: 2,
  });

  assert.ok(result.omitted > 0);
  assert.match(result.summary, /message-0/);
  assert.match(result.history[0].text, /压缩摘要/);
  assert.match(result.history.at(-1)?.text || '', /message-19/);
});

test('agent runner persists run parts and supports durable tool approval', async () => {
  const ai = await import('../../lib/server/ai.js');
  const { runAgentTurn, resolveApproval } = await import('../../lib/server/agent/runner.js');
  const { agentRunStore } = await import('../../lib/server/agent/store/index.js');
  let banCalls = 0;
  const client = {
    getGroupMemberInfo: async (_groupId: number | string, userId: number | string) => ({
      status: 'ok',
      data: { user_id: userId, role: userId === 999 ? 'admin' : 'member' },
    }),
    setGroupBan: async () => {
      banCalls += 1;
      return { status: 'ok' };
    },
  };
  const event = {
    post_type: 'message',
    message_type: 'group',
    group_id: 10001,
    user_id: 111,
    self_id: 999,
    message_id: 1,
    raw_message: '[CQ:at,qq=999] 禁言 [CQ:at,qq=222]',
    message: '[CQ:at,qq=999] 禁言 [CQ:at,qq=222]',
    sender: { nickname: 'admin' },
  };
  const cfg = {
    ai_enabled: true,
    ai_provider: 'gemini',
    ai_api_key: 'test-key',
    ai_model: 'gemini-test',
    ai_context_enabled: false,
    ai_memory_enabled: false,
    ai_group_context_enabled: false,
    agent_tool_permissions: { qq_mute_member: 'ask' },
  };

  const previous = ai._overrideChat((async (_input: unknown, _history: unknown, _cfg: unknown, options: Record<string, any>) => {
    options.onBuiltinToolCalls([{
      callId: 'ws_agent_test',
      name: 'web_search',
      status: 'completed',
      input: { action: 'search', queries: ['测试查询'] },
      output: { source_count: 1 },
    }], { round: 1 });
    const result = await options.executeFunctionCall('qq_mute_member', { target_user_id: 222, duration_seconds: 60 }, {
      round: 1,
      index: 1,
      executedToolCalls: 1,
    });
    return result.message;
  }) as any);

  try {
    const turn = await runAgentTurn({ event, client, cfg, cleanMsg: '禁言 222', requesterIsAdmin: true });
    assert.equal(turn.run.status, 'waiting_approval');
    assert.equal(banCalls, 0);
    const approvals = agentRunStore.listApprovals('pending');
    assert.equal(approvals.length, 1);
    const parts = agentRunStore.listParts(turn.run.id);
    assert.ok(parts.some((part) => part.type === 'tool_call'));
    assert.ok(parts.some((part) => (
      part.type === 'tool_call' && part.tool_name === 'web_search' && part.metadata.builtin === true
    )));
    assert.ok(parts.some((part) => (
      part.type === 'tool_result' && part.tool_name === 'web_search' && part.metadata.builtin === true
    )));

    const approved = await resolveApproval({
      approvalId: approvals[0].id,
      approve: true,
      event: { ...event, raw_message: '确认执行' },
      client,
      cfg,
    });
    assert.equal(approved.ok, true);
    assert.equal(banCalls, 1);
    assert.equal(agentRunStore.getApproval(approvals[0].id)?.status, 'consumed');
    assert.equal(agentRunStore.getRun(turn.run.id)?.status, 'completed');
  } finally {
    ai._restoreChat(previous);
  }
});

test('provider registry rejects unknown providers instead of silently using Gemini', async () => {
  const { getProvider } = await import('../../lib/server/ai/chat.js');
  assert.throws(() => getProvider({ ai_provider: 'unknown' }), /不支持的 AI Provider/);
});

test('SQLite agent store persists sessions, runs, parts and recovery status', async () => {
  process.env.QQ_BOT_STORE_BACKEND = 'sqlite';
  process.env.QQ_BOT_DB_PATH = ':memory:';
  const { resetDb } = await import('../../lib/server/store/sqlite/db.js');
  const { agentRunStore } = await import('../../lib/server/agent/store/index.js');
  resetDb();
  try {
    const session = agentRunStore.getOrCreateSession('private:42', 'assistant');
    const run = agentRunStore.createRun({
      id: 'run-sqlite',
      session_id: session.id,
      agent: 'assistant',
      provider: 'gemini',
      model: 'test',
      status: 'running',
      step: 0,
      input: 'hello',
      output: '',
      error: '',
    });
    agentRunStore.addPart({
      id: 'part-sqlite',
      run_id: run.id,
      session_id: session.id,
      type: 'input',
      status: 'completed',
      tool_name: '',
      content: 'hello',
      metadata: { source: 'test' },
    });

    assert.equal(agentRunStore.getRun(run.id)?.status, 'running');
    assert.deepEqual(agentRunStore.listParts(run.id)[0].metadata, { source: 'test' });
    assert.equal(agentRunStore.recoverInterruptedRuns(), 1);
    assert.equal(agentRunStore.getRun(run.id)?.status, 'interrupted');
  } finally {
    resetDb();
    process.env.QQ_BOT_STORE_BACKEND = 'json';
    delete process.env.QQ_BOT_DB_PATH;
  }
});
