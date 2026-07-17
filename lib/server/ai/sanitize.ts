// 思维链泄漏检测与清洗 —— 模型无关，基于文本特征

import type { SanitizedReply } from './types.js';

function extractAfterFinalMarker(text: string): string {
  const match = text.match(
    /(?:^|\n)\s*(?:final(?:\s+answer)?|final|最终(?:回复|回答|答案)|给用户的(?:回复|回答)|正文|回答)[:：]?\s*\n([\s\S]+)$/i
  );
  return match ? match[1].trim() : '';
}

function stripDelimitedThoughts(text: string): { text: string; changed: boolean } {
  let changed = false;
  let next = text.replace(
    /<\s*(think|thought|thinking|analysis|reasoning|scratchpad)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,
    () => {
      changed = true;
      return '';
    }
  );
  next = next.replace(
    /```(?:thought|thinking|analysis|reasoning|scratchpad)[\s\S]*?```/gi,
    () => {
      changed = true;
      return '';
    }
  );
  return { text: next.trim(), changed };
}

function startsWithThoughtLabel(text: string): boolean {
  return /^\s*[_#*\-\s]*(?:thought|thinking|analysis|reasoning|scratchpad|chain[-_\s]*of[-_\s]*thought|思维链|思考过程|思考|推理|草稿)(?:\s*[:：]|\s|$)/i
    .test(text);
}

function containsThoughtLine(text: string): boolean {
  return /(?:^|\n)\s*[_#*\-\s]*(?:thought|thinking|analysis|reasoning|scratchpad|chain[-_\s]*of[-_\s]*thought|思维链|思考过程|思考|推理|草稿)(?:\s*[:：]|\s|$)/i
    .test(text);
}

// 极少数情况下（通常在多轮工具调用后），模型最终这一轮吐出的不是自然语言回复，
// 而是一小段残留的 JSON/工具调用碎片（比如 "0}"）。这种输出直接发到群里会很突兀，
// 用同样长度很短、且完全不含任何文字（只剩数字/括号/引号这类符号）作为特征来识别。
function isDegenerateJsonFragment(text: string): boolean {
  if (text.length > 6) return false;
  if (!/[{}[\]]/.test(text)) return false;
  return !/[\p{L}]/u.test(text);
}

const LINK_REQUEST_NOUN = '(?:链接|网址|URL|来源|出处|参考资料|参考文献|links?|urls?|sources?|citations?|references?)';

function userExplicitlyRequestsLinks(userMessage: unknown): boolean {
  const text = String(userMessage || '').replace(/\[CQ:[^\]]*]/gi, ' ').trim();
  if (!text) return false;
  if (new RegExp(`(?:不要|不用|无需|不需要|别|无需提供).{0,8}${LINK_REQUEST_NOUN}`, 'i').test(text)) {
    return false;
  }
  return new RegExp(
    `(?:给我|发我|提供|列出|附上|贴出|展示|告诉我|补充|带上|需要|想要|要看|求).{0,12}${LINK_REQUEST_NOUN}` +
    `|${LINK_REQUEST_NOUN}.{0,12}(?:给我|发我|提供|列出|附上|贴出|展示|是什么|在哪里|有吗)` +
    `|(?:give|send|provide|show|list|include|cite|share).{0,20}${LINK_REQUEST_NOUN}`,
    'i'
  ).test(text);
}

function stripUnrequestedLinks(text: string, userMessage: unknown): string {
  if (!text || userExplicitlyRequestsLinks(userMessage)) return text;

  let next = text.replace(
    /(?:^|\n)\s*(?:来源|出处|参考(?:资料|来源|文献)|sources?|references?|citations?)\s*[:：]?\s*\n?[\s\S]*$/i,
    ''
  );
  next = next.replace(/!\[[^\]]*]\(\s*<?https?:\/\/[^\s)>]+>?\s*\)/gi, '');
  next = next.replace(
    /\[([^\]]*)]\(\s*<?https?:\/\/[^\s)>]+>?\s*\)/gi,
    (_match, label: string) => /^(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(label.trim()) ? '' : label.trim()
  );
  next = next.replace(/<https?:\/\/[^\s>]+>/gi, '');
  next = next.replace(/https?:\/\/[^\s<>\])}]+/gi, '');
  next = next.replace(/\bwww\.[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s<>\])}]*)?/gi, '');
  next = next.replace(/[（(]\s*[）)]/g, '');
  next = next.replace(/[ \t]+([，。！？；：,.!?;:])/g, '$1');
  next = next.replace(/[ \t]{2,}/g, ' ');
  next = next.replace(/\n[ \t]+/g, '\n');
  return next.trim();
}

function sanitizeModelReply(raw: unknown): SanitizedReply {
  const original = String(raw || '').trim();
  if (!original) return { text: '', leaked: false, blocked: false, reason: '' };

  const stripped = stripDelimitedThoughts(original);
  const text = stripped.text;
  if (!text) {
    return {
      text: '',
      leaked: stripped.changed,
      blocked: stripped.changed,
      reason: 'delimited_thought_only',
    };
  }

  if (isDegenerateJsonFragment(text)) {
    return { text: '', leaked: true, blocked: true, reason: 'degenerate_json_fragment' };
  }

  const finalText = extractAfterFinalMarker(text);
  if (startsWithThoughtLabel(text)) {
    return finalText
      ? { text: finalText, leaked: true, blocked: false, reason: 'leading_thought_with_final_marker' }
      : { text: '', leaked: true, blocked: true, reason: 'leading_thought_label' };
  }

  if (containsThoughtLine(text)) {
    return finalText
      ? { text: finalText, leaked: true, blocked: false, reason: 'thought_line_with_final_marker' }
      : { text: '', leaked: true, blocked: true, reason: 'thought_line' };
  }

  if (stripped.changed) {
    return { text, leaked: true, blocked: false, reason: 'delimited_thought_removed' };
  }

  return { text, leaked: false, blocked: false, reason: '' };
}

export {
  sanitizeModelReply,
  stripUnrequestedLinks,
  userExplicitlyRequestsLinks,
};
