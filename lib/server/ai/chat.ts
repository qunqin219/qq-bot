// 工具循环主逻辑 —— 模型无关，通过 LLMProvider 接口与具体模型交互

import type { LLMProvider } from './provider.js';
import type { AiConfig, ChatOptions, ToolResult } from './types.js';

import { providerRegistry } from './registry.js';
import {
  errorMessage,
  oneLinePreview,
  compactJson,
  previewText,
  toolCallKey,
  fallbackToolMessages,
  summarizeRequestedFunctionCalls,
} from './utils.js';
import { sanitizeModelReply, stripUnrequestedLinks } from './sanitize.js';
import { resolveNumber, sleep, isRetryableHttpStatus, retryDelayMs } from './retry.js';
import {
  DEFAULT_MAX_TOOL_ROUNDS,
  DEFAULT_MAX_TOOL_CALLS,
  DEFAULT_MAX_FUNCTION_CALLS_PER_ROUND,
  DEFAULT_MAX_HTTP_RETRIES,
  DEFAULT_HTTP_RETRY_BASE_DELAY_MS,
  MAX_HTTP_RETRY_DELAY_MS,
  THOUGHT_LEAK_REPAIR_PROMPT,
} from './types.js';

function getProvider(cfg: AiConfig): LLMProvider {
  return providerRegistry.require(String(cfg.ai_provider || 'gemini'));
}

function isConfigured(cfg: AiConfig): boolean {
  if (!cfg || cfg.ai_enabled !== true) return false;
  return getProvider(cfg).isConfigured(cfg);
}

async function buildRequestBody(
  userMessage: unknown,
  history: unknown,
  cfg: AiConfig,
  options: ChatOptions = {}
): Promise<any> {
  return getProvider(cfg).buildRequestBody(userMessage, history, cfg, options);
}

/**
 * 调用 LLM 生成 AI 回复（带多轮工具调用循环）。
 *
 * @param userMessage - 当前用户消息文本，允许包含 QQ CQ 图片码
 * @param history - 本地会话历史，格式 [{ role: 'user'|'model', text: '...' }]
 * @param cfg - 配置对象
 * @param options - 可选工具调用配置
 * @returns AI 回复文本；未配置或调用失败时返回 null
 */
async function chat(
  userMessage: unknown,
  history: unknown,
  cfg: AiConfig,
  options: ChatOptions = {}
): Promise<string | null> {
  if (!cfg || cfg.ai_enabled !== true) {
    return null;
  }

  const provider = getProvider(cfg);
  if (!provider.isConfigured(cfg)) return null;
  const { model, baseUrl } = provider.describeRequest(cfg);

  const maxToolRounds = resolveNumber(options.maxToolRounds, DEFAULT_MAX_TOOL_ROUNDS, 1, 8);
  const maxToolCalls = resolveNumber(options.maxToolCalls, DEFAULT_MAX_TOOL_CALLS, 1, 20);
  const maxCallsPerRound = resolveNumber(
    options.maxCallsPerRound,
    DEFAULT_MAX_FUNCTION_CALLS_PER_ROUND,
    1,
    5
  );
  const maxHttpRetries = resolveNumber(options.maxHttpRetries, DEFAULT_MAX_HTTP_RETRIES, 0, 5);
  const httpRetryBaseDelayMs = resolveNumber(
    options.httpRetryBaseDelayMs,
    DEFAULT_HTTP_RETRY_BASE_DELAY_MS,
    0,
    MAX_HTTP_RETRY_DELAY_MS
  );

  const body = await provider.buildRequestBody(userMessage, history, cfg, options);
  const currentUserContent = provider.getLastUserContent(body);
  const seenToolCalls = new Set();
  const allToolResults: ToolResult[] = [];
  let executedToolCalls = 0;
  let thoughtLeakRepairCount = 0;
  const requestStartedAt = Date.now();

  console.log(
    `[AI] ${provider.name} 请求开始 model=${model} base_url=${baseUrl} items=${provider.getInputItemCount(body)} ` +
    `image_parts=${provider.countInlineImageParts(body)} tools=${compactJson(provider.summarizeEnabledTools(body))} ` +
    `max_rounds=${maxToolRounds} max_tool_calls=${maxToolCalls}`
  );

  try {
    for (let round = 1; round <= maxToolRounds + 1; round += 1) {
      if (options.signal?.aborted) throw options.signal.reason || new Error('agent run cancelled');
      let resp: Response | null = null;
      for (let attempt = 0; attempt <= maxHttpRetries; attempt += 1) {
        if (options.signal?.aborted) throw options.signal.reason || new Error('agent run cancelled');
        const roundStartedAt = Date.now();
        console.log(
          `[AI] ${provider.name} 第${round}轮请求开始 attempt=${attempt + 1}/${maxHttpRetries + 1} ` +
          `items=${provider.getInputItemCount(body)} executed_tool_calls=${executedToolCalls}`
        );
        resp = await provider.sendRequest(body, cfg, options.signal);
        console.log(
          `[AI] ${provider.name} 第${round}轮响应 status=${resp.status} duration_ms=${Date.now() - roundStartedAt} ` +
          `attempt=${attempt + 1}/${maxHttpRetries + 1}`
        );
        if (resp.ok) break;

        const errText = await resp.text().catch(() => '');
        const retryable = isRetryableHttpStatus(resp.status);
        const canRetry = retryable && attempt < maxHttpRetries;
        if (!canRetry) {
          console.error(
            `[AI] ${provider.name} request 第${round}轮返回错误 ${resp.status} ` +
            `attempt=${attempt + 1}/${maxHttpRetries + 1}: ${oneLinePreview(errText, 500)}`
          );
          if (retryable) {
            console.warn(`[AI] ${provider.name} 第${round}轮重试耗尽 status=${resp.status}，本次不回复`);
            return null;
          }
          return fallbackToolMessages(allToolResults);
        }

        const waitMs = retryDelayMs(resp, httpRetryBaseDelayMs * (2 ** attempt));
        console.warn(
          `[AI] ${provider.name} 第${round}轮返回可重试错误 ${resp.status}，${waitMs}ms 后重试 ` +
          `attempt=${attempt + 1}/${maxHttpRetries + 1}: ${oneLinePreview(errText, 300)}`
        );
        await sleep(waitMs);
      }

      if (!resp?.ok) return null;

      const data = await resp.json();
      const functionCalls = provider.extractFunctionCalls(data);
      const rawReply = provider.extractOutputText(data);

      // 记录模型思考过程（thought parts），用于后续分析模型决策逻辑
      const thoughtText = provider.extractThoughtText(data);
      if (thoughtText) {
        console.log(
          `[AI] ${provider.name} 思考过程 round=${round} chars=${thoughtText.length}\n` +
          `--- THINK START ---\n${thoughtText}\n--- THINK END ---`
        );
      }

      const sanitizedReply = sanitizeModelReply(rawReply);
      const reply = stripUnrequestedLinks(sanitizedReply.text, userMessage);
      const responseMetadata = provider.summarizeResponseMetadata(data);
      if (responseMetadata) {
        console.log(`[ToolAudit] builtin_metadata round=${round} ${compactJson(responseMetadata)}`);
      }
      const builtinToolCalls = provider.extractBuiltinToolCalls(data);
      if (builtinToolCalls.length > 0 && typeof options.onBuiltinToolCalls === 'function') {
        options.onBuiltinToolCalls(builtinToolCalls, { round });
      }
      if (functionCalls.length === 0 || typeof options.executeFunctionCall !== 'function') {
        if (sanitizedReply.leaked) {
          console.warn(
            `[AI] ${provider.name} 回复异常（内部思考泄漏或残留碎片）reason=${sanitizedReply.reason} ` +
            `blocked=${sanitizedReply.blocked} round=${round}`
          );
        }
        if (sanitizedReply.blocked) {
          if (thoughtLeakRepairCount < 1 && round <= maxToolRounds) {
            thoughtLeakRepairCount += 1;
            provider.appendUserMessage(body, THOUGHT_LEAK_REPAIR_PROMPT);
            console.warn(`[AI] ${provider.name} 内部思考泄漏已拦截，重试生成最终回复 round=${round}`);
            continue;
          }
          console.warn(`[AI] ${provider.name} 内部思考泄漏重试耗尽，本次不回复 round=${round}`);
          return null;
        }
        if (reply) {
          if (typeof options.onFinalTurn === 'function') {
            const modelContent = provider.buildModelContentForHistory(
              provider.getModelContent(data), reply, sanitizedReply
            );
            options.onFinalTurn({
              userContent: currentUserContent,
              modelContent,
              reply,
            });
          }
          console.log(
            `[AI] ${provider.name} 回复完成 duration_ms=${Date.now() - requestStartedAt} rounds=${round} ` +
            `tool_calls=${executedToolCalls} reply_chars=${reply.length} reply_preview="${previewText(reply)}"`
          );
          return reply;
        }
        console.warn(`[AI] ${provider.name} 返回空回复:`, JSON.stringify(data).slice(0, 500));
        return fallbackToolMessages(allToolResults);
      }

      console.log(
        `[ToolAudit] model_requested round=${round} requested=${compactJson(summarizeRequestedFunctionCalls(functionCalls))}`
      );

      if (round > maxToolRounds || executedToolCalls >= maxToolCalls) {
        console.warn(`[AI] 工具调用达到限制 round=${round} executed=${executedToolCalls}`);
        return sanitizedReply.blocked ? fallbackToolMessages(allToolResults) : (reply || fallbackToolMessages(allToolResults));
      }

      const roundToolResults: ToolResult[] = [];
      const remainingCalls = Math.max(0, maxToolCalls - executedToolCalls);
      const callsToRun = functionCalls.slice(0, Math.min(maxCallsPerRound, remainingCalls));
      if (functionCalls.length > callsToRun.length) {
        console.warn(
          `[ToolAudit] 本轮工具调用超过限制 round=${round} requested=${functionCalls.length} running=${callsToRun.length}`
        );
        for (const call of functionCalls.slice(callsToRun.length)) {
          roundToolResults.push({
            callId: call.callId,
            name: call.name,
            response: {
              ok: false,
              skipped: true,
              message: '本轮工具调用超过宿主限制，未执行此调用。请根据已有结果继续回答。',
            },
          });
        }
      }

      for (const [index, call] of callsToRun.entries()) {
        if (options.signal?.aborted) throw options.signal.reason || new Error('agent run cancelled');
        const key = toolCallKey(call);
        if (seenToolCalls.has(key)) {
          console.warn(`[ToolAudit] duplicate_skipped round=${round} name=${call.name} args=${compactJson(call.args || {})}`);
          roundToolResults.push({
            callId: call.callId,
            name: call.name,
            response: {
              ok: false,
              duplicate: true,
              message: '重复工具调用已跳过，请根据已有工具结果回答，不要重复调用同名同参数工具',
            },
          });
          continue;
        }

        seenToolCalls.add(key);
        executedToolCalls += 1;
        const response = await options.executeFunctionCall!(call.name, call.args || {}, {
          round,
          index: index + 1,
          executedToolCalls,
        });
        const item = { callId: call.callId, name: call.name, response };
        roundToolResults.push(item);
        allToolResults.push(item);
      }

      if (roundToolResults.length === 0) {
        console.warn('[AI] 模型请求工具但没有可执行调用，停止工具循环');
        return sanitizedReply.blocked ? fallbackToolMessages(allToolResults) : (reply || fallbackToolMessages(allToolResults));
      }

      if (!provider.appendToolResults(body, data, roundToolResults)) {
        console.warn('[AI] 模型请求工具但缺少可继续的响应条目，停止工具循环');
        return sanitizedReply.blocked ? fallbackToolMessages(allToolResults) : (reply || fallbackToolMessages(allToolResults));
      }
    }

    console.warn(
      `[AI] ${provider.name} 工具循环结束但没有最终文本 duration_ms=${Date.now() - requestStartedAt} ` +
      `tool_calls=${executedToolCalls}`
    );
    return fallbackToolMessages(allToolResults);
  } catch (e: unknown) {
    if (options.signal?.aborted) throw e;
    console.error(`[AI] 调用 ${provider.name} 异常:`, errorMessage(e));
    return fallbackToolMessages(allToolResults);
  }
}

export { buildRequestBody, chat, getProvider, isConfigured };
