import type { AiRuntimePreviewInput } from '../types.js';

import { loadConfig } from '../../config.js';
import { conversationStore } from '../../store/index.js';
import * as ai from '../../ai.js';
import { isConfiguredAdmin, getMemberRole } from '../permissions.js';
import { buildGroupManagementFunctionDeclarations } from '../tools/declarations.js';
import { buildMemorySystemPrompt } from '../tools/memory.js';
import { buildGroupContextInlineParts } from '../tools/image.js';
import { getRecentGroupMessages, buildGroupAwarePrompt } from './group-context.js';
import { resolveQuotedMessageChain } from './quote-chain.js';

async function buildAiRuntimePreview({ event, client, cfg }: AiRuntimePreviewInput): Promise<Record<string, any>> {
  if (!event) throw new Error('event is required');
  const runtimeCfg = cfg || loadConfig();
  let msg = event.raw_message || '';
  if (!msg) {
    const raw = event.message;
    msg = typeof raw === 'string' ? raw : String(raw || '');
  }

  const groupId = event.group_id;
  const userId = event.user_id || 0;
  const isAdmin = isConfiguredAdmin(runtimeCfg, userId);
  const conversationKey = conversationStore.getConversationKey(event);
  const contextTurns = Math.max(1, Number(runtimeCfg.ai_context_turns || 10));
  const conversationHistory = runtimeCfg.ai_context_enabled
    ? conversationStore.getHistory(
      conversationKey,
      Math.max(contextTurns * 2, Math.max(1, Number(runtimeCfg.agent_session_max_turns || 200)) * 2)
    )
    : [];
  // 群聊不是一对一私聊。把稀疏的 Bot 触发轮次作为 provider role history 会破坏真实时间线，
  // 因此群聊统一在结构化事件时间线中合并历史；私聊仍保留标准多轮 history。
  const history = groupId ? [] : conversationHistory;

  const botRole = groupId
    ? await getMemberRole(client, groupId, event.self_id)
    : 'none';
  const managementToolsEnabled = Boolean(
    groupId &&
    isAdmin &&
    ['owner', 'admin'].includes(botRole)
  );
  const memberListToolsEnabled = Boolean(groupId && isAdmin);
  const managementContext = groupId
    ? {
      botRole,
      toolsEnabled: managementToolsEnabled,
      memberListEnabled: memberListToolsEnabled,
      requesterIsAdmin: isAdmin,
    }
    : null;

  // 群消息只查一次并在文字上下文、图片上下文之间共用，避免同一轮回复里重复查库/重复处理图片。
  const recentGroupMessages = groupId ? getRecentGroupMessages(event, runtimeCfg) : [];
  // 显式引用链也只解析一次。文字上下文与多模态图片共享同一份关系快照，避免重复 API 查询产生漂移。
  const quotedMessageChain = groupId && runtimeCfg.ai_group_context_include_quote
    ? await resolveQuotedMessageChain(msg, client, 3)
    : [];
  const aiInput = await buildGroupAwarePrompt(
    event,
    client,
    runtimeCfg,
    msg,
    managementContext,
    recentGroupMessages,
    conversationHistory,
    quotedMessageChain
  );
  const groupInlineImageParts = groupId
    ? await buildGroupContextInlineParts(event, client, runtimeCfg, quotedMessageChain)
    : [];
  // 历史图片默认不主动塞给模型看，改成让模型按需调用 qq_read_image 工具读取。
  const groupImageToolEnabled = Boolean(groupId) && runtimeCfg.ai_group_context_enabled === true;
  const functionDeclarations = buildGroupManagementFunctionDeclarations({
    memoryEnabled: runtimeCfg.ai_memory_enabled === true,
    imageReadEnabled: groupImageToolEnabled,
    memberListEnabled: memberListToolsEnabled,
    managementEnabled: managementToolsEnabled,
  });
  const extraSystemInstruction = runtimeCfg.ai_memory_enabled === true
    ? buildMemorySystemPrompt(conversationKey)
    : '';
  const requestBody = await ai.buildRequestBody(aiInput, history, runtimeCfg, {
    functionDeclarations,
    extraSystemInstruction,
    autoAttachImages: !groupId || groupInlineImageParts.length === 0,
    extraParts: groupInlineImageParts,
  });

  return {
    conversationKey,
    contextTurns,
    history,
    conversationHistory,
    quotedMessageChain,
    botRole,
    managementContext,
    functionDeclarations,
    extraSystemInstruction,
    aiInput,
    requestBody,
    groupInlineImageParts,
  };
}

export { buildAiRuntimePreview };
