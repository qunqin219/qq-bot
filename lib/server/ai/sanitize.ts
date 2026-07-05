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
};
