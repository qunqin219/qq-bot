import type { BotConfig, OneBotClient, OneBotEvent } from '../types.js';

import { conversationStore } from '../../store/index.js';
import { runAgentTurn } from '../../agent/runner.js';
import { QQChannelAdapter } from '../../agent/channel.js';
import {
  compactJson,
  previewText,
  getEventSenderName,
  summarizeOneBotResult,
  geminiTextContent,
} from '../utils.js';
import { parseAiReplyDirective } from '../reply.js';

async function handleAiTurn(
  event: OneBotEvent,
  client: OneBotClient,
  cfg: BotConfig,
  ctxInfo: { userId: number | string; msgType: string; groupId: number | string | null | undefined; isAdmin: boolean; cleanMsg: string }
): Promise<void> {
  const { userId, msgType, groupId, isAdmin, cleanMsg } = ctxInfo;
  const startedAt = Date.now();
  const channel = new QQChannelAdapter(client);

  let result;
  try {
    result = await runAgentTurn({
      event,
      client,
      cfg,
      cleanMsg,
      requesterIsAdmin: isAdmin,
      onProgress: async (progress) => {
        const sendResult = await channel.sendProgress(event, progress.text);
        if (sendResult?.status && sendResult.status !== 'ok') {
          throw new Error(String(sendResult.wording || sendResult.msg || `OneBot status=${sendResult.status}`));
        }
        console.log(
          `[Agent] 过程消息发送完成 run=${progress.runId} index=${progress.index} round=${progress.round} ` +
          `source=${progress.source} result=${compactJson(summarizeOneBotResult(sendResult))}`
        );
      },
    });
  } catch (error) {
    console.error('[BotCore] Agent 运行失败:', error);
    return;
  }

  let aiReply = result.reply;
  if (!aiReply) {
    console.warn(`[Agent] 回复为空 run=${result.run.id} conversation=${result.conversationKey}`);
    return;
  }

  const parsedReply = parseAiReplyDirective(aiReply);
  aiReply = parsedReply.text;
  if (!aiReply) return;

  console.log(
    `[Agent] 回复完成 run=${result.run.id} agent=${result.agent} conversation=${result.conversationKey} ` +
    `type=${msgType || '-'} group=${groupId || '-'} user=${userId || '-'} duration_ms=${Date.now() - startedAt} ` +
    `chars=${aiReply.length} preview="${previewText(aiReply, 240)}"`
  );

  const speakerLabel = `${getEventSenderName(event)}(QQ:${userId || '未知'})`;
  const providerTurn = result.finalProviderTurn;
  const historyUserContent = groupId
    ? geminiTextContent('user', `${speakerLabel} 说：${cleanMsg}`)
    : providerTurn?.userContent;
  conversationStore.appendTurn(
    result.conversationKey,
    cleanMsg,
    aiReply,
    Math.max(result.contextTurns, Number(cfg.agent_session_max_turns || 200)),
    groupId ? {
      user_id: userId,
      user_name: String(getEventSenderName(event)),
      user_gemini_content: historyUserContent,
      model_gemini_content: providerTurn?.modelContent,
    } : {
      user_gemini_content: historyUserContent,
      model_gemini_content: providerTurn?.modelContent,
    }
  );

  const sendResult = await channel.send(event, cfg, aiReply, parsedReply.replyMessageId);
  console.log(
    `[Agent] 回复发送完成 run=${result.run.id} conversation=${result.conversationKey} ` +
    `sender=${previewText(getEventSenderName(event), 80) || '-'} result=${compactJson(summarizeOneBotResult(sendResult))}`
  );
}

export { handleAiTurn };
