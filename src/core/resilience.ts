export const MAX_RETRY_DELAY_MS = 120_000;
export interface FailureContext { definitive: boolean; transient: boolean; sideEffects: boolean; pendingReview: boolean; approvalResume: boolean; retries: number; fallbackUsed: boolean; currentModel: string; fallbackModel: string; minimumDelayMs?: number; retryAfterTooLong?: boolean; rateLimited?: boolean }
export function recoveryAction(state: FailureContext): { type: 'retry'; delay: number; continueSession?: boolean } | { type: 'fallback'; model: string; delay?: number } | { type: 'stop' } {
  // Unknown delivery, an approved action or a review can never be replayed automatically.
  if (!state.definitive || state.sideEffects || state.pendingReview || state.approvalResume) return { type: 'stop' };
  // A long quota hint is not permission to retry sooner or assume a daily quota resets.
  // Never pass an overflowing/untrusted delay to setTimeout (which can become a 1 ms wait).
  const minimum = state.minimumDelayMs ?? 0;
  if (state.retryAfterTooLong || !Number.isFinite(minimum) || minimum < 0 || minimum > MAX_RETRY_DELAY_MS || !Number.isSafeInteger(state.retries) || state.retries < 0) return { type: 'stop' };
  if (state.transient && state.retries < 2) return { type: 'retry', delay: Math.max(state.retries === 0 ? 1000 : 3000, Math.ceil(minimum)), ...(state.rateLimited ? { continueSession: true } : {}) };
  // A second model can share the same provider/account quota. Do not bypass its hint.
  if (!state.fallbackUsed && state.fallbackModel && state.fallbackModel !== state.currentModel) return { type: 'fallback', model: state.fallbackModel, ...(minimum > 0 ? { delay: Math.ceil(minimum) } : {}) };
  return { type: 'stop' };
}

/** A definitive quota refusal can retain successful reads without resubmitting the original request. */
export function quotaContinuationInput(): Array<{type: 'user.message'; content: string}> {
  return [{ type: 'user.message', content: 'Continue the original request from this session after the provider quota wait. Use the successful tool observations already in this session; do not repeat completed actions. Read any source freshly before staging an edit. All edits and commands still require their normal review and approval.' }];
}

/** Async UI wait: Stop rejects immediately and clears both timer and listener. */
export function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > MAX_RETRY_DELAY_MS) return Promise.reject(new Error('Retry delay is outside the automatic wait limit.'));
  if (signal.aborted) return Promise.reject(new Error('Run cancelled.'));
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new Error('Run cancelled.')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, delayMs);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
