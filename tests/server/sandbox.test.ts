import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { AgentTurnInput, AgentTurnResult } from '../../lib/server/agent/runner.js';
import { QQSandbox, SandboxRequestError } from '../../lib/server/sandbox.js';

function config() {
  return {
    ai_enabled: true,
    ai_provider: 'gemini',
    ai_api_key: 'sandbox-test-key',
    ai_model: 'gemini-test',
    ai_context_enabled: true,
    ai_memory_enabled: true,
    ai_group_context_enabled: true,
    admins: [],
  };
}

function result(reply: string, runId = 'sandbox-run'): AgentTurnResult {
  const now = new Date().toISOString();
  return {
    reply,
    sessionId: 'sandbox-session',
    agent: 'assistant',
    conversationKey: 'sandbox:test',
    contextTurns: 20,
    finalProviderTurn: null,
    run: {
      id: runId,
      session_id: 'sandbox-session',
      agent: 'assistant',
      provider: 'gemini',
      model: 'gemini-test',
      status: 'completed',
      step: 0,
      input: '',
      output: reply,
      error: '',
      created_at: now,
      updated_at: now,
      completed_at: now,
    },
  };
}

test('QQ sandbox isolates private and group messages without NapCat', async () => {
  const calls: AgentTurnInput[] = [];
  const sandbox = new QQSandbox({
    config,
    run: async (input) => {
      calls.push(input);
      return result('沙盒私聊回复');
    },
  });

  const response = await sandbox.send({ mode: 'private', text: '你好' });
  assert.equal(response.reply?.text, '沙盒私聊回复');
  assert.equal(response.state.messages.private.length, 2);
  assert.equal(response.state.messages.group.length, 0);
  assert.equal(response.state.napcat_connected, false);
  assert.equal(response.state.isolated, true);
  assert.equal(calls[0].runtime?.conversationKey, 'sandbox:private');
  assert.match(calls[0].runtime?.extraSystemInstruction || '', /不连接 NapCat/);
  assert.equal(calls[0].cfg.ai_memory_enabled, false);
});

test('group sandbox can accumulate ambient chat and pass it into the real Agent runtime boundary', async () => {
  const calls: AgentTurnInput[] = [];
  let quotedMessageId = 0;
  const sandbox = new QQSandbox({
    config,
    run: async (input) => {
      calls.push(input);
      return result(`引用消息ID：${quotedMessageId}\n已结合群聊上下文处理`);
    },
  });

  const ambient = await sandbox.send({
    mode: 'group',
    sender_id: 99001002,
    text: '今晚九点发布，先检查回归测试。',
    trigger_ai: false,
  });
  quotedMessageId = ambient.incoming.message_id;
  assert.equal(ambient.reply, null);
  assert.equal(calls.length, 0);

  const triggered = await sandbox.send({
    mode: 'group',
    sender_id: 99001001,
    text: '总结一下刚才的安排。',
    trigger_ai: true,
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].runtime?.history[0]?.text || '', /今晚九点发布/);
  assert.match(calls[0].runtime?.aiInput || '', /Agent 沙盒测试群/);
  assert.equal(calls[0].requesterIsAdmin, true);
  assert.equal(triggered.reply?.reply_to, ambient.incoming.message_id);
});

test('sandbox OneBot management calls mutate only simulated group state and reset cleanly', async () => {
  const sandbox = new QQSandbox({ config, run: async () => result('ok') });

  assert.equal((await sandbox.client.setGroupBan!(-990001, 99001002, 600)).status, 'ok');
  assert.equal(sandbox.getState().group.members.find((member) => member.user_id === 99001002)?.muted_until !== null, true);
  await assert.rejects(
    sandbox.send({ mode: 'group', sender_id: 99001002, text: '我还能发言吗', trigger_ai: false }),
    (error: unknown) => error instanceof SandboxRequestError && /禁言/.test(error.message)
  );

  await sandbox.client.setGroupBan!(-990001, 99001002, 0);
  await sandbox.client.setGroupWholeBan!(-990001, true);
  await assert.rejects(
    sandbox.send({ mode: 'group', sender_id: 99001003, text: '全员禁言测试', trigger_ai: false }),
    (error: unknown) => error instanceof SandboxRequestError && /全员禁言/.test(error.message)
  );

  await sandbox.client.setGroupKick!(-990001, 99001003, false);
  assert.equal(sandbox.getState().group.members.find((member) => member.user_id === 99001003)?.kicked, true);
  const reset = sandbox.reset();
  assert.equal(reset.group.whole_ban, false);
  assert.equal(reset.group.members.every((member) => !member.kicked && member.muted_until === null), true);
  assert.equal(reset.messages.private.length + reset.messages.group.length, 0);
});
