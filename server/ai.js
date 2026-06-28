// Gemini AI 调用模块 —— generateContent 兼容格式，支持文字 + QQ 图片识别
//
// 说明：很多 Gemini 中转只兼容 generateContent，不支持官方新出的 Interactions API。
// 因此这里使用：POST {base_url}/models/{model}:generateContent?key={api_key}
//
// 兼容能力：
// - 上下文：contents = 历史消息 + 当前用户消息
// - 系统提示词：systemInstruction
// - 思考控制：generationConfig.thinkingConfig.thinkingBudget
// - Google Search：tools: [{ googleSearch: {} }]
// - URL Context：tools: [{ urlContext: {} }]
// - 识图：解析 QQ [CQ:image,...url=...]，下载后作为 inline_data 发给 Gemini

const MAX_IMAGES_PER_MESSAGE = 3;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function getBeijingTimeText() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return `当前北京时间：${get('year')}年${get('month')}月${get('day')}日，${get('weekday')}，${get('hour')}:${get('minute')}:${get('second')}。`;
}

function buildSystemInstruction(systemPrompt) {
  return [
    getBeijingTimeText(),
    String(systemPrompt || '').trim(),
  ].filter(Boolean).join('\n');
}

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&#44;/g, ',')
    .replace(/&#91;/g, '[')
    .replace(/&#93;/g, ']')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

function parseCqParams(body) {
  const params = {};
  for (const item of String(body || '').split(',')) {
    const idx = item.indexOf('=');
    if (idx === -1) continue;
    const key = item.slice(0, idx).trim();
    const value = item.slice(idx + 1).trim();
    params[key] = decodeHtmlEntities(value);
  }
  return params;
}

function isStickerMessage(message) {
  const raw = decodeHtmlEntities(String(message || ''));
  return (
    /\[CQ:mface[,\]]/.test(raw) ||
    /\[CQ:image,[^\]]*(summary=\[动画表情\]|sub_type=1)/.test(raw)
  );
}

function extractImageUrls(message, options = {}) {
  if (options.ignoreStickers && isStickerMessage(message)) return [];
  const urls = [];
  const raw = String(message || '');
  const re = /\[CQ:image,([^\]]+)\]/g;
  let match;
  while ((match = re.exec(raw)) !== null) {
    const params = parseCqParams(match[1]);
    if (params.url && /^https?:\/\//i.test(params.url)) {
      urls.push(params.url);
    }
  }
  return [...new Set(urls)].slice(0, MAX_IMAGES_PER_MESSAGE);
}

function stripCqCodes(message) {
  return decodeHtmlEntities(String(message || ''))
    .replace(/\[CQ:[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function imageUrlToPart(url) {
  try {
    const resp = await fetch(url, {
      headers: {
        // QQ 图片 CDN 有时会拒绝空 UA。
        'User-Agent': 'Mozilla/5.0 QQBot/1.0',
      },
    });
    if (!resp.ok) {
      console.warn(`[AI] 图片下载失败 ${resp.status}: ${url.slice(0, 160)}`);
      return null;
    }

    const contentType = (resp.headers.get('content-type') || 'image/jpeg')
      .split(';')[0]
      .trim();
    if (!contentType.startsWith('image/')) {
      console.warn(`[AI] 非图片 content-type: ${contentType}`);
      return null;
    }

    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) {
      console.warn(`[AI] 图片过大，已跳过: ${buf.length} bytes`);
      return null;
    }

    // generateContent REST 多模态字段；大多数中转兼容 inline_data。
    return {
      inline_data: {
        mime_type: contentType,
        data: buf.toString('base64'),
      },
    };
  } catch (e) {
    console.warn('[AI] 图片下载异常:', e.message);
    return null;
  }
}

async function buildCurrentUserParts(userMessage, cfg = {}) {
  const imageUrls = extractImageUrls(userMessage, { ignoreStickers: cfg.ai_filter_stickers !== false });
  const text = stripCqCodes(userMessage) || (imageUrls.length ? '请分析这张图片。' : String(userMessage || ''));
  const parts = [{ text }];

  for (const url of imageUrls) {
    const part = await imageUrlToPart(url);
    if (part) parts.push(part);
  }

  return parts;
}

async function buildContents(userMessage, history, cfg = {}) {
  const safeHistory = Array.isArray(history) ? history : [];
  const contents = safeHistory
    .filter((m) => m && (m.role === 'user' || m.role === 'model') && m.text)
    .map((m) => ({
      role: m.role,
      parts: [{ text: String(m.text) }],
    }));

  contents.push({
    role: 'user',
    parts: await buildCurrentUserParts(userMessage, cfg),
  });

  return contents;
}

function thinkingBudgetFromLevel(level) {
  // generateContent 没有 Interactions API 的 thinking_level。
  // 用 thinkingBudget 做兼容映射：数值越大，思考越多；0 表示尽量关闭。
  if (level === 'low') return 1024;
  if (level === 'high') return 8192;
  return 4096; // medium
}

function buildTools(cfg, functionDeclarations = []) {
  const tools = [];
  if (functionDeclarations.length > 0) {
    tools.push({ functionDeclarations });
  }
  if (cfg.ai_google_search_enabled === true) {
    tools.push({ googleSearch: {} });
  }
  if (cfg.ai_url_context_enabled === true) {
    tools.push({ urlContext: {} });
  }
  return tools;
}

function extractFunctionCalls(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts
    .filter((part) => part.functionCall && part.functionCall.name)
    .map((part) => part.functionCall);
}

function buildFunctionResponseParts(results) {
  return results.map((item) => ({
    functionResponse: {
      name: item.name,
      response: item.response,
    },
  }));
}

function extractOutputText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts
    .filter((part) => typeof part.text === 'string' && part.text)
    .map((part) => part.text)
    .join('')
    .trim();
}

/**
 * 调用 Gemini generateContent 生成 AI 回复。
 *
 * @param {string} userMessage - 当前用户消息文本，允许包含 QQ CQ 图片码
 * @param {Array} history - 本地会话历史，格式 [{ role: 'user'|'model', text: '...' }]
 * @param {object} cfg - 配置对象
 * @param {object} options - 可选工具调用配置：{ functionDeclarations, executeFunctionCall }
 * @returns {Promise<string|null>} AI 回复文本；未配置或调用失败时返回 null
 */
async function chat(userMessage, history, cfg, options = {}) {
  if (!cfg || cfg.ai_enabled !== true || !String(cfg.ai_api_key || '').trim()) {
    return null;
  }

  const baseUrl = (cfg.ai_base_url || 'https://generativelanguage.googleapis.com/v1beta')
    .replace(/\/+$/, '');
  const model = cfg.ai_model || 'gemini-3.5-flash';
  const apiKey = String(cfg.ai_api_key || '').trim();
  const systemPrompt = cfg.ai_system_prompt || '';

  const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: await buildContents(userMessage, history, cfg),
  };

  const systemInstruction = buildSystemInstruction(systemPrompt);
  if (systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  const generationConfig = {};
  if (cfg.ai_thinking_enabled === true) {
    generationConfig.thinkingConfig = {
      thinkingBudget: thinkingBudgetFromLevel(cfg.ai_thinking_level),
    };
  }
  if (Object.keys(generationConfig).length > 0) {
    body.generationConfig = generationConfig;
  }

  const functionDeclarations = Array.isArray(options.functionDeclarations)
    ? options.functionDeclarations
    : [];
  const tools = buildTools(cfg, functionDeclarations);
  if (tools.length > 0) {
    body.tools = tools;
  }

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      console.error(
        `[AI] Gemini generateContent 返回错误 ${resp.status}: ${errText.slice(0, 500)}`
      );
      return null;
    }

    const data = await resp.json();
    const functionCalls = extractFunctionCalls(data);
    if (functionCalls.length > 0 && typeof options.executeFunctionCall === 'function') {
      const toolResults = [];
      for (const call of functionCalls.slice(0, 3)) {
        const response = await options.executeFunctionCall(call.name, call.args || {});
        toolResults.push({ name: call.name, response });
      }

      const followUpBody = {
        ...body,
        contents: [
          ...body.contents,
          data.candidates[0].content,
          {
            role: 'user',
            parts: buildFunctionResponseParts(toolResults),
          },
        ],
      };

      const followUpResp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(followUpBody),
      });
      if (!followUpResp.ok) {
        const errText = await followUpResp.text().catch(() => '');
        console.error(
          `[AI] Gemini 工具结果二次生成错误 ${followUpResp.status}: ${errText.slice(0, 500)}`
        );
        return toolResults
          .map((item) => item.response?.message)
          .filter(Boolean)
          .join('\n') || null;
      }
      const followUpData = await followUpResp.json();
      const followUpReply = extractOutputText(followUpData);
      if (followUpReply) return followUpReply;

      return toolResults
        .map((item) => item.response?.message)
        .filter(Boolean)
        .join('\n') || null;
    }

    const reply = extractOutputText(data);
    if (!reply) {
      console.warn('[AI] Gemini 返回空回复:', JSON.stringify(data).slice(0, 500));
      return null;
    }

    return reply;
  } catch (e) {
    console.error('[AI] 调用 Gemini generateContent 异常:', e.message);
    return null;
  }
}

module.exports = { chat, stripCqCodes, extractImageUrls, isStickerMessage };
