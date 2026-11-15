const transientStatuses = new Set([429, 500, 502, 503, 504]);
export const transientStatus = status => transientStatuses.has(status);

export function retryAfterMs(value, now = Date.now()) {
  if (typeof value !== 'string' || !value.trim()) return 0;
  if (/^\d+(?:\.\d+)?$/.test(value.trim())) return Number(value) * 1000;
  const delay = Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(0, delay) : 0;
}

export function temporaryNetworkError(error) {
  const code = error?.cause?.code || error?.code;
  if (code) return /^(?:ECONNRESET|ECONNREFUSED|ECONNABORTED|EPIPE|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|UND_ERR_(?:CONNECT_TIMEOUT|HEADERS_TIMEOUT|BODY_TIMEOUT|SOCKET))$/.test(code);
  if (error instanceof TypeError && /fetch failed|network|terminated/i.test(error.message)) return true;
  // Tencent's SDK retains only the network error message, not its code/cause.
  // Inspect bounded known signatures locally; never expose the message.
  return /\b(?:ECONNRESET|ECONNREFUSED|ECONNABORTED|EPIPE|ETIMEDOUT|EAI_AGAIN|ENOTFOUND)\b|socket hang up|network timeout|request timed out|request timeout|timed out|connection reset|premature close/i.test(String(error?.message || '').slice(0, 2000));
}

export function abortableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); cleanup(); reject(signal.reason); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

// Only normalized errors explicitly marked by the transport are retryable.
// Semantic validation, authorization and malformed content never enter here.
export async function withRetries(operation, { signal, retryAttempts = 1, onRetry, sleep = abortableDelay, random = Math.random, abortError }) {
  const maxAttempts = Number.isInteger(retryAttempts) ? Math.max(1, Math.min(8, retryAttempts)) : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) throw abortError();
    try { return await operation(attempt); }
    catch (error) {
      if (signal?.aborted) throw abortError();
      // Do not truncate an excessive server delay and retry too early, even
      // if a caller resumes this failed operation from a saved checkpoint.
      if (error.retryAfterMs > 86400000) error.retryable = false;
      if (attempt === maxAttempts || error.retryable !== true) throw error;
      const delayMs = Math.max(1000 * 2 ** (attempt - 1) + Math.floor(Math.max(0, Math.min(1, random())) * 250), error.retryAfterMs || 0);
      try { onRetry?.({ attempt, nextAttempt: attempt + 1, maxAttempts, delayMs, code: error.code, ...(Number.isInteger(error.httpStatus) ? { httpStatus: error.httpStatus } : {}) }); } catch { /* Progress cannot change an operation. */ }
      try { await sleep(delayMs, signal); }
      catch (waitError) { if (signal?.aborted) throw abortError(); throw waitError; }
    }
  }
}
