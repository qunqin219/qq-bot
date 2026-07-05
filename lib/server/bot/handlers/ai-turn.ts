import type { BotConfig, OneBotClient, OneBotEvent, ToolArgs } from '../types.js';

import * as ai from '../../ai.js';
import { conversationStore } from '../../store/index.js';
import {
  errorMessage,
  compactJson,
  previewText,
  getEventSenderName,
  buildEnabledToolAuditList,
  summarizeToolResult,
  summarizeOneBotResult,
  geminiTextContent,
  extractReplyMessageId,
} from '../utils.js';
import { parseAiReplyDirective, buildGroupReplyMessage } from '../reply.js';
import { buildAiRuntimePreview } from '../context/preview.js';
import { executeGroupManagementTool } from '../tools/management.js';

async function handleAiTurn(
  event: OneBotEvent,
  client: OneBotClient,
  cfg: BotConfig,
  ctxInfo: { userId: number | string; msgType: string; groupId: number | string | null | undefined; isAdmin: boolean; cleanMsg: string }
): Promise<void> {
  const { userId, msgType, groupId, isAdmin, cleanMsg } = ctxInfo;
  const runtime = await buildAiRuntimePreview({ event, client, cfg });
  const {
    conversationKey,
    contextTurns,
    botRole,
    functionDeclarations,
    extraSystemInstruction,
    aiInput,
    groupInlineImageParts,
  } = runtime;
  const aiStartedAt = Date.now();
  console.log(
    `[AI] 回复开始 conversation=${conversationKey} type=${msgType || '-'} group=${groupId || '-'} user=${userId || '-'} ` +
    `message_id=${event.message_id || '-'} sender=${previewText(getEventSenderName(event), 80) || '-'} ` +
    `context_turns=${contextTurns} tools=${buildEnabledToolAuditList(cfg, functionDeclarations)} ` +
    `input="${previewText(cleanMsg, 240)}"`
  );

  let aiReply;
  let finalGeminiTurn: {
    userContent: Record<string, any>;
    modelContent: Record<string, any>;
    reply: string;
  } | null = null;
  try {
    aiReply = await ai.chat(aiInput, runtime.history, cfg, {
      functionDeclarations,
      extraSystemInstruction,
      autoAttachImages: !groupId || groupInlineImageParts.length === 0,
      extraParts: groupInlineImageParts,
      onFinalTurn: (turn: Record<string, any>) => {
        finalGeminiTurn = turn as any;
      },
      executeFunctionCall: async (name: string, args: ToolArgs, meta: Record<string, any> = {}) => {
        const toolStartedAt = Date.now();
        const round = meta.round || '-';
        const index = meta.index || '-';
        const auditId = [
          event.message_id || Date.now(),
          round !== '-' ? `r${round}` : null,
          index !== '-' ? `i${index}` : null,
          name,
        ].filter(Boolean).join(':');
        console.log(
          `[ToolAudit] start id=${auditId} name=${name} round=${round} index=${index} ` +
          `conversation=${conversationKey} group=${groupId || '-'} user=${userId || '-'} args=${compactJson(args || {})}`
        );
        try {
          const result = await executeGroupManagementTool(name, args, {
            event,
            client,
            cfg,
            botRole,
            requesterIsAdmin: isAdmin,
          });
          console.log(
            `[ToolAudit] end id=${auditId} name=${name} duration_ms=${Date.now() - toolStartedAt} ` +
            `result=${compactJson(summarizeToolResult(result))}`
          );
          return result;
        } catch (e) {
          console.error(
            `[ToolAudit] error id=${auditId} name=${name} duration_ms=${Date.now() - toolStartedAt} ` +
            `error=${errorMessage(e)}`
          );
          throw e;
        }
      },
    });
  } catch (err) {
    console.error('[BotCore] AI 回复失败:', err);
    return;
  }

  if (!aiReply) {
    console.warn(
      `[AI] 回复为空 conversation=${conversationKey} duration_ms=${Date.now() - aiStartedAt} ` +
      `message_id=${event.message_id || '-'}`
    );
    return;
  }

  const parsedReply = parseAiReplyDirective(aiReply);
  if (groupId && parsedReply.replyMessageId) {
    console.log(`[BotCore] 模型选择引用 message_id=${parsedReply.replyMessageId}`);
  }
  aiReply = parsedReply.text;
  if (!aiReply) {
    console.warn(
      `[AI] 回复解析后为空 conversation=${conversationKey} duration_ms=${Date.now() - aiStartedAt} ` +
      `message_id=${event.message_id || '-'}`
    );
    return;
  }

  console.log(
    `[AI] 回复生成完成 conversation=${conversationKey} duration_ms=${Date.now() - aiStartedAt} ` +
    `reply_chars=${String(aiReply).length} quote_message_id=${parsedReply.replyMessageId || '-'} ` +
    `reply_preview="${previewText(aiReply, 240)}"`
  );

  const historyUserText = cleanMsg;
  const historyAssistantText = aiReply;
  // 群聊历史是全群共享的，多个人的问答会混在同一份历史里；
  // 只在"用户"这一侧的历史文本里标注发言人（role=user，模型不会把这种文本当成自己该说的话去模仿）。
  // 注意：绝不能在"模型"这一侧的历史文本里加类似前缀——模型会把自己过去说过的话当成范本，
  // 学着在新回复里也主动加上"机器人（回复XXX）："这种前缀，然后这段内部标注就被当成正文发到群里了。
  const speakerLabel = `${getEventSenderName(event)}(QQ:${userId || '未知'})`;
  const historyUserGeminiContent = groupId
    ? geminiTextContent('user', `${speakerLabel} 说：${historyUserText}`)
    : (finalGeminiTurn as Record<string, any> | null)?.userContent;
  conversationStore.appendTurn(conversationKey, historyUserText, historyAssistantText, contextTurns, groupId ? {
    user_id: userId,
    user_name: String(getEventSenderName(event)),
    user_gemini_content: historyUserGeminiContent,
    model_gemini_content: (finalGeminiTurn as Record<string, any> | null)?.modelContent,
  } : {
    user_gemini_content: historyUserGeminiContent,
    model_gemini_content: (finalGeminiTurn as Record<string, any> | null)?.modelContent,
  });

  if (groupId) {
    const outboundMessage = buildGroupReplyMessage(event, cfg, aiReply, parsedReply.replyMessageId);
    console.log(
      `[AI] 发送群回复 conversation=${conversationKey} group=${groupId} message_id=${event.message_id || '-'} ` +
      `chars=${String(aiReply).length} quote_message_id=${parsedReply.replyMessageId || extractReplyMessageId(outboundMessage) || '-'}`
    );
    const sendResult = await client.sendGroupMsg!(groupId, outboundMessage);
    console.log(`[AI] 群回复发送完成 conversation=${conversationKey} result=${compactJson(summarizeOneBotResult(sendResult))}`);
  } else {
    console.log(
      `[AI] 发送私聊回复 conversation=${conversationKey} user=${userId || '-'} ` +
      `message_id=${event.message_id || '-'} chars=${String(aiReply).length}`
    );
    const sendResult = await client.sendPrivateMsg!(userId as any, aiReply);
    console.log(`[AI] 私聊回复发送完成 conversation=${conversationKey} result=${compactJson(summarizeOneBotResult(sendResult))}`);
  }
}

export { handleAiTurn };
