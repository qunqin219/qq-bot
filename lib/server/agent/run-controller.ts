type ActiveRun = { controller: AbortController; timer: NodeJS.Timeout };
const active = new Map<string, ActiveRun>();

export function startRunController(runId: string, timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  const safeTimeout = Math.max(5_000, Math.min(10 * 60_000, timeoutMs || 120_000));
  const timer = setTimeout(() => controller.abort(new Error('agent run timed out')), safeTimeout);
  timer.unref();
  active.set(runId, { controller, timer });
  controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  return controller.signal;
}

export function cancelRun(runId: string, reason = 'cancelled by user'): boolean {
  const current = active.get(runId);
  if (!current) return false;
  current.controller.abort(new Error(reason));
  clearTimeout(current.timer);
  active.delete(runId);
  return true;
}

export function finishRunController(runId: string): void {
  const current = active.get(runId);
  if (current) clearTimeout(current.timer);
  active.delete(runId);
}
