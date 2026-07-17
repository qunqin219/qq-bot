import type { HistoryItem } from '../../ai/types.js';

type BudgetResult = {
  history: HistoryItem[];
  omitted: number;
  summary: string;
  estimatedTokens: number;
};

export function estimateTokens(value: unknown): number {
  return Math.max(1, Math.ceil(JSON.stringify(value ?? '').length / 4));
}

function summarize(items: HistoryItem[], maxChars = 4000): string {
  const lines = items.map((item) => {
    const speaker = item.role === 'model' ? 'Bot' : '用户';
    return `${speaker}: ${String(item.text || '').replace(/\s+/g, ' ').trim()}`;
  });
  const text = lines.join('\n');
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
}

export function applyContextBudget(history: unknown, options: {
  totalTokens: number;
  reserveOutputTokens: number;
  recentTurns: number;
  previousSummary?: string;
}): BudgetResult {
  const items = (Array.isArray(history) ? history : []).filter((item): item is HistoryItem => {
    return Boolean(item && (item.role === 'user' || item.role === 'model') && typeof item.text === 'string');
  });
  const budget = Math.max(1000, options.totalTokens - options.reserveOutputTokens);
  const minimumTail = Math.max(2, options.recentTurns * 2);
  const kept: HistoryItem[] = [];
  let used = 0;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    const cost = estimateTokens(item);
    if (kept.length >= minimumTail && used + cost > budget) break;
    kept.unshift(item);
    used += cost;
  }
  const omittedItems = items.slice(0, Math.max(0, items.length - kept.length));
  const freshSummary = summarize(omittedItems);
  const summary = (freshSummary || String(options.previousSummary || '').trim()).slice(-6000);
  if (summary) {
    kept.unshift({ role: 'user', text: `【更早对话的压缩摘要，仅作上下文】\n${summary}` });
  }
  return { history: kept, omitted: omittedItems.length, summary, estimatedTokens: used + estimateTokens(summary) };
}
