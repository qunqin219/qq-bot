import { randomUUID } from 'node:crypto';
import type {
  SandboxMember,
  SandboxMessage,
  SandboxMode,
  SandboxSendInput,
  SandboxSendResponse,
  SandboxStateResponse,
} from '../shared/types.js';
import type { BotConfig, OneBotClient, OneBotEvent, OneBotResult } from './bot/types.js';
import * as ai from './ai.js';
import { loadConfig } from './config.js';
import { runAgentTurn } from './agent/runner.js';
import type { AgentTurnResult } from './agent/runner.js';
import { parseAiReplyDirective } from './bot/reply.js';
import { withConversationLock } from './bot/conversation-lock.js';

const BOT_ID = 99000001;
// 负数 ID 不可能与真实 QQ 群冲突。
const GROUP_ID = -990001;
const OWNER_ID = 99001001;
const MEMBER_ID = 99001002;
const SECOND_MEMBER_ID = 99001003;

type SandboxDependencies = {
  config?: () => BotConfig;
  run?: typeof runAgentTurn;
};

export class SandboxRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'SandboxRequestError';
    this.status = status;
  }
}

function initialMembers(): SandboxMember[] {
  return [
    { user_id: OWNER_ID, nickname: '林澈', card: '群主·林澈', role: 'owner', muted_until: null, kicked: false },
    { user_id: BOT_ID, nickname: 'Agent Bot', card: 'Agent Bot', role: 'admin', muted_until: null, kicked: false },
    { user_id: MEMBER_ID, nickname: '小北', card: '测试员·小北', role: 'member', muted_until: null, kicked: false },
    { user_id: SECOND_MEMBER_ID, nickname: '阿遥', card: '', role: 'member', muted_until: null, kicked: false },
  ];
}

function displayName(member: SandboxMember): string {
  return member.card || member.nickname || String(member.user_id);
}

function normalizeMode(value: unknown): SandboxMode {
  if (value === 'private' || value === 'group') return value;
  throw new SandboxRequestError(400, 'mode 必须是 private 或 group');
}

function safeText(value: unknown): string {
  const text = String(value || '').trim();
  if (!text) throw new SandboxRequestError(400, '消息内容不能为空');
  if (text.length > 8_000) throw new SandboxRequestError(400, '单条沙盒消息不能超过 8000 字符');
  return text;
}

function ok<T>(data?: T): OneBotResult<T> {
  return { status: 'ok', data };
}

export class QQSandbox {
  private readonly getConfig: () => BotConfig;
  private readonly run: typeof runAgentTurn;
  private members: SandboxMember[] = initialMembers();
  private wholeBan = false;
  private nextMessageId = 880000;
  private readonly messages: Record<SandboxMode, SandboxMessage[]> = { private: [], group: [] };
  readonly client: OneBotClient;

  constructor(dependencies: SandboxDependencies = {}) {
    this.getConfig = dependencies.config || loadConfig;
    this.run = dependencies.run || runAgentTurn;
    this.client = this.createClient();
  }

  reset(): SandboxStateResponse {
    this.members = initialMembers();
    this.wholeBan = false;
    this.nextMessageId = 880000;
    this.messages.private = [];
    this.messages.group = [];
    return this.getState();
  }

  getState(): SandboxStateResponse {
    const cfg = this.sandboxConfig();
    const privatePeer = this.members.find((member) => member.user_id === OWNER_ID)!;
    return structuredClone({
      isolated: true as const,
      napcat_connected: false as const,
      ai_configured: ai.isConfigured(cfg),
      provider: String(cfg.ai_provider || 'gemini'),
      model: String(cfg.ai_model || ''),
      bot: { user_id: BOT_ID, nickname: 'Agent Bot', role: 'admin' as const },
      private_peer: privatePeer,
      group: {
        group_id: GROUP_ID,
        group_name: 'Agent 沙盒测试群',
        whole_ban: this.wholeBan,
        members: this.members,
      },
      messages: this.messages,
    });
  }

  async send(input: SandboxSendInput): Promise<SandboxSendResponse> {
    const mode = normalizeMode(input?.mode);
    return withConversationLock(`sandbox:${mode}`, async () => {
      const text = safeText(input?.text);
      const sender = this.resolveSender(mode, input?.sender_id);
      const replyTo = this.resolveReplyTarget(mode, input?.reply_to);
      const triggerAi = mode === 'private' ? true : input?.trigger_ai !== false;
      const incoming = this.addMessage({
        mode,
        userId: sender.user_id,
        senderName: displayName(sender),
        senderRole: sender.role,
        text,
        replyTo,
        fromBot: false,
      });

      if (!triggerAi) {
        return { ok: true, state: this.getState(), incoming, reply: null, run_id: null };
      }

      const cfg = this.sandboxConfig();
      if (!cfg.ai_enabled) throw new SandboxRequestError(409, 'AI 回复当前已关闭，请先在设置中启用');
      if (!ai.isConfigured(cfg)) throw new SandboxRequestError(409, '当前 AI Provider 尚未配置 API Key');

      const result: AgentTurnResult = await this.run({
        event: this.buildEvent(incoming, sender),
        client: this.client,
        cfg,
        cleanMsg: text,
        requesterIsAdmin: sender.user_id === OWNER_ID,
        runtime: this.buildRuntime(mode, incoming),
        onProgress: async (progress) => {
          this.addMessage({
            mode,
            userId: BOT_ID,
            senderName: 'Agent Bot',
            senderRole: 'admin',
            text: progress.text,
            replyTo: null,
            fromBot: true,
            kind: 'progress',
            runId: progress.runId,
          });
        },
      });

      const parsed = parseAiReplyDirective(result.reply || '');
      const validReplyTarget = parsed.replyMessageId && this.messages[mode]
        .some((message) => message.message_id === parsed.replyMessageId)
        ? parsed.replyMessageId
        : null;
      const reply = parsed.text
        ? this.addMessage({
          mode,
          userId: BOT_ID,
          senderName: 'Agent Bot',
          senderRole: 'admin',
          text: parsed.text,
          replyTo: validReplyTarget,
          fromBot: true,
          kind: 'message',
          runId: result.run.id,
          agent: result.agent,
        })
        : null;
      return { ok: true, state: this.getState(), incoming, reply, run_id: result.run.id };
    });
  }

  private sandboxConfig(): BotConfig {
    const cfg = { ...this.getConfig() };
    return {
      ...cfg,
      admins: [...new Set([...(cfg.admins || []), OWNER_ID])],
      active_groups: [...new Set([...(cfg.active_groups || []), GROUP_ID])],
      group_filter_enabled: false,
      ai_memory_enabled: false,
      ai_group_context_enabled: false,
    };
  }

  private resolveSender(mode: SandboxMode, rawSenderId: unknown): SandboxMember {
    const senderId = mode === 'private' ? OWNER_ID : Number(rawSenderId || OWNER_ID);
    const sender = this.members.find((member) => member.user_id === senderId && !member.kicked && member.user_id !== BOT_ID);
    if (!sender) throw new SandboxRequestError(400, '发送者不在当前模拟群中，或已经被移出');
    if (mode === 'group' && sender.muted_until && new Date(sender.muted_until).getTime() > Date.now()) {
      throw new SandboxRequestError(409, `${displayName(sender)} 当前处于模拟禁言状态`);
    }
    if (mode === 'group' && this.wholeBan && sender.role === 'member') {
      throw new SandboxRequestError(409, '模拟群已开启全员禁言，普通成员无法发言');
    }
    return sender;
  }

  private resolveReplyTarget(mode: SandboxMode, rawMessageId: unknown): number | null {
    if (rawMessageId === undefined || rawMessageId === null || rawMessageId === '') return null;
    const messageId = Number(rawMessageId);
    const exists = Number.isFinite(messageId) && this.messages[mode].some((message) => message.message_id === messageId);
    if (!exists) throw new SandboxRequestError(400, '引用消息不属于当前沙盒会话');
    return messageId;
  }

  private addMessage(input: {
    mode: SandboxMode;
    userId: number;
    senderName: string;
    senderRole: string;
    text: string;
    replyTo: number | null;
    fromBot: boolean;
    kind?: 'message' | 'progress';
    runId?: string;
    agent?: string;
  }): SandboxMessage {
    const message: SandboxMessage = {
      id: randomUUID(),
      message_id: this.nextMessageId++,
      mode: input.mode,
      group_id: input.mode === 'group' ? GROUP_ID : null,
      user_id: input.userId,
      sender_name: input.senderName,
      sender_role: input.senderRole,
      text: input.text,
      reply_to: input.replyTo,
      from_bot: input.fromBot,
      kind: input.kind || 'message',
      created_at: new Date().toISOString(),
      ...(input.runId ? { run_id: input.runId } : {}),
      ...(input.agent ? { agent: input.agent } : {}),
    };
    this.messages[input.mode].push(message);
    if (this.messages[input.mode].length > 200) this.messages[input.mode].splice(0, this.messages[input.mode].length - 200);
    return message;
  }

  private buildEvent(message: SandboxMessage, sender: SandboxMember): OneBotEvent {
    const replyCode = message.reply_to ? `[CQ:reply,id=${message.reply_to}]` : '';
    const atCode = message.mode === 'group' ? `[CQ:at,qq=${BOT_ID}] ` : '';
    return {
      post_type: 'message',
      message_type: message.mode,
      group_id: message.group_id,
      user_id: sender.user_id,
      self_id: BOT_ID,
      message_id: message.message_id,
      raw_message: `${replyCode}${atCode}${message.text}`,
      message: `${replyCode}${atCode}${message.text}`,
      sender: {
        user_id: sender.user_id,
        nickname: sender.nickname,
        card: sender.card,
        role: sender.role,
      },
    };
  }

  private buildRuntime(mode: SandboxMode, current: SandboxMessage) {
    const previous = this.messages[mode]
      .filter((message) => message.id !== current.id && message.kind !== 'progress')
      .slice(-40);
    const history = previous.map((message) => ({
      role: message.from_bot ? 'model' as const : 'user' as const,
      text: mode === 'group' && !message.from_bot
        ? `${message.sender_name}(QQ:${message.user_id}) 说：${message.text}`
        : message.text,
    }));
    const replyTarget = current.reply_to
      ? this.messages[mode].find((message) => message.message_id === current.reply_to)
      : null;
    const groupSnapshot = mode === 'group'
      ? `\n模拟群：Agent 沙盒测试群(${GROUP_ID})\n当前发送者：${current.sender_name}(QQ:${current.user_id}, ${current.sender_role})\n` +
        `全员禁言：${this.wholeBan ? '开启' : '关闭'}\n` +
        `当前成员：${this.members.filter((member) => !member.kicked).map((member) => `${displayName(member)}(QQ:${member.user_id},${member.role})`).join('、')}`
      : '';
    const quoteSnapshot = replyTarget
      ? `\n引用消息：message_id=${replyTarget.message_id}，${replyTarget.sender_name} 说「${replyTarget.text}」`
      : '';
    return {
      conversationKey: `sandbox:${mode}`,
      history,
      aiInput: `${current.sender_name}(QQ:${current.user_id}) 在 QQ ${mode === 'group' ? '群聊' : '私聊'}中说：${current.text}${groupSnapshot}${quoteSnapshot}`,
      contextTurns: 20,
      groupInlineImageParts: [],
      extraSystemInstruction: [
        '你正在 QQ 沙盒中运行。这里不连接 NapCat，也不连接真实 QQ。',
        '沙盒提供的群成员与消息都是真实 Agent Runtime 上的模拟数据；可以正常使用可用工具来完成测试。',
        '任何禁言、解禁、踢人或全员禁言只影响本次进程内的模拟群，绝不能声称操作了真实 QQ。',
        '回复保持适合 QQ 的简洁纯文本格式。',
      ].join('\n'),
    };
  }

  private createClient(): OneBotClient {
    const ensureGroup = (groupId: number | string): boolean => Number(groupId) === GROUP_ID;
    return {
      connected: true,
      getLoginInfo: async () => ok({ user_id: BOT_ID, nickname: 'Agent Bot' }),
      getGroupList: async () => ok([{
        group_id: GROUP_ID,
        group_name: 'Agent 沙盒测试群',
        member_count: this.members.filter((member) => !member.kicked).length,
      }]),
      getGroupMemberList: async (groupId: number | string) => ensureGroup(groupId)
        ? ok(this.members.filter((member) => !member.kicked).map((member) => ({ ...member })))
        : { status: 'failed', msg: 'sandbox group not found' },
      getGroupMemberInfo: async (groupId: number | string, userId: number | string) => {
        const member = ensureGroup(groupId)
          ? this.members.find((item) => item.user_id === Number(userId) && !item.kicked)
          : null;
        return member ? ok({ ...member }) : { status: 'failed', msg: 'sandbox member not found' };
      },
      getMsg: async (messageId: number | string) => {
        const message = [...this.messages.private, ...this.messages.group]
          .find((item) => item.message_id === Number(messageId));
        return message ? ok({
          message_id: message.message_id,
          user_id: message.user_id,
          group_id: message.group_id,
          raw_message: message.text,
          message: message.text,
          sender: { user_id: message.user_id, nickname: message.sender_name, role: message.sender_role },
        }) : { status: 'failed', msg: 'sandbox message not found' };
      },
      setGroupWholeBan: async (groupId: number | string, enable: boolean) => {
        if (!ensureGroup(groupId)) return { status: 'failed', msg: 'sandbox group not found' };
        this.wholeBan = Boolean(enable);
        return ok();
      },
      setGroupBan: async (groupId: number | string, userId: number | string, duration: number) => {
        const member = ensureGroup(groupId)
          ? this.members.find((item) => item.user_id === Number(userId) && !item.kicked)
          : null;
        if (!member) return { status: 'failed', msg: 'sandbox member not found' };
        member.muted_until = duration > 0 ? new Date(Date.now() + duration * 1_000).toISOString() : null;
        return ok();
      },
      setGroupKick: async (groupId: number | string, userId: number | string) => {
        const member = ensureGroup(groupId)
          ? this.members.find((item) => item.user_id === Number(userId) && !item.kicked)
          : null;
        if (!member) return { status: 'failed', msg: 'sandbox member not found' };
        member.kicked = true;
        return ok();
      },
      sendGroupMsg: async (groupId: number | string, text: string) => {
        if (!ensureGroup(groupId)) return { status: 'failed', msg: 'sandbox group not found' };
        const sent = this.addMessage({
          mode: 'group', userId: BOT_ID, senderName: 'Agent Bot', senderRole: 'admin',
          text: String(text), replyTo: null, fromBot: true,
        });
        return ok({ message_id: sent.message_id });
      },
      sendPrivateMsg: async (userId: number | string, text: string) => {
        if (Number(userId) !== OWNER_ID) return { status: 'failed', msg: 'sandbox peer not found' };
        const sent = this.addMessage({
          mode: 'private', userId: BOT_ID, senderName: 'Agent Bot', senderRole: 'admin',
          text: String(text), replyTo: null, fromBot: true,
        });
        return ok({ message_id: sent.message_id });
      },
    };
  }
}

export const qqSandbox = new QQSandbox();
