#!/usr/bin/env node

declare const require: any;
declare const process: any;

const botCore = require('../lib/server/bot-core');
const { loadConfig } = require('../lib/server/config');

type PreviewConfig = Record<string, any> & {
  admins?: Array<number | string>;
};

type PreviewPart = {
  text?: string;
  inline_data?: {
    data?: string;
    mime_type?: string;
  };
  functionResponse?: {
    name?: string;
    response?: unknown;
  };
};

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function summarizePart(part: PreviewPart): Record<string, unknown> {
  if (typeof part?.text === 'string') {
    return {
      type: 'text',
      length: part.text.length,
      text: part.text,
    };
  }
  if (part?.inline_data) {
    const data = String(part.inline_data.data || '');
    return {
      type: 'inline_data',
      mime_type: part.inline_data.mime_type,
      base64_length: data.length,
      approx_bytes: Math.floor(data.length * 3 / 4),
    };
  }
  if (part?.functionResponse) {
    return {
      type: 'functionResponse',
      name: part.functionResponse.name,
      response: part.functionResponse.response,
    };
  }
  return { type: 'unknown', keys: Object.keys(part || {}) };
}

async function main() {
  const cfg: PreviewConfig = loadConfig();
  const raw = process.argv.slice(2).join(' ').trim() || '[CQ:at,qq=1525899506] sam最新动态';
  const selfId = numberEnv('PREVIEW_SELF_ID', 1525899506);
  const userId = numberEnv('PREVIEW_USER_ID', Number(cfg.admins?.[0] || 3605900361));
  const groupId = numberEnv('PREVIEW_GROUP_ID', 424242424);
  const botRole = process.env.PREVIEW_BOT_ROLE || 'admin';

  const event = {
    post_type: 'message',
    message_type: 'group',
    group_id: groupId,
    user_id: userId,
    self_id: selfId,
    message_id: Number(process.env.PREVIEW_MESSAGE_ID || Date.now()),
    raw_message: raw,
    message: raw,
    sender: {
      nickname: process.env.PREVIEW_NICKNAME || 'preview-user',
      card: process.env.PREVIEW_CARD || 'preview-user',
    },
  };

  const client = {
    connected: true,
    getGroupMemberInfo: async (_groupId, queriedUserId) => ({
      status: 'ok',
      data: {
        user_id: queriedUserId,
        nickname: queriedUserId === selfId ? '呆猫' : 'preview-member',
        card: queriedUserId === selfId ? '呆猫' : 'preview-member',
        role: queriedUserId === selfId ? botRole : 'member',
      },
    }),
    getMsg: async () => ({ status: 'failed', data: null }),
  };

  const preview = await botCore.buildAiRuntimePreview({ event, client, cfg });
  const body = preview.requestBody;
  const toolNames = (body.tools || []).flatMap((tool: Record<string, any>) => {
    if (Array.isArray(tool.functionDeclarations)) {
      return tool.functionDeclarations.map((item: Record<string, any>) => item.name);
    }
    if (tool.googleSearch) return ['googleSearch'];
    if (tool.urlContext) return ['urlContext'];
    return Object.keys(tool);
  });

  const output = {
    event: {
      group_id: event.group_id,
      user_id: event.user_id,
      self_id: event.self_id,
      raw_message: event.raw_message,
    },
    config: {
      ai_base_url: cfg.ai_base_url,
      ai_model: cfg.ai_model,
      ai_context_enabled: cfg.ai_context_enabled,
      ai_context_turns: cfg.ai_context_turns,
      ai_group_context_enabled: cfg.ai_group_context_enabled,
      ai_group_context_messages: cfg.ai_group_context_messages,
      ai_google_search_enabled: cfg.ai_google_search_enabled,
      ai_url_context_enabled: cfg.ai_url_context_enabled,
      ai_memory_enabled: cfg.ai_memory_enabled,
      ai_key_present: Boolean(String(cfg.ai_api_key || '').trim()),
      ai_key_length: String(cfg.ai_api_key || '').length,
    },
    runtime: {
      conversationKey: preview.conversationKey,
      botRole: preview.botRole,
      managementContext: preview.managementContext,
      historyMessages: preview.history.length,
      tools: toolNames,
    },
    aiInput: preview.aiInput,
    requestBodySummary: {
      systemInstructionLength: body.systemInstruction?.parts?.[0]?.text?.length || 0,
      systemInstructionPreview: body.systemInstruction?.parts?.[0]?.text || '',
      contents: (body.contents || []).map((content: Record<string, any>) => ({
        role: content.role,
        parts: (content.parts || []).map((part: PreviewPart) => summarizePart(part)),
      })),
      tools: body.tools || [],
      generationConfig: body.generationConfig || null,
    },
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

export {};
