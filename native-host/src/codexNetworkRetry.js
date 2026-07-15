'use strict';

const { collectMirrorChangesDetailed, markMirrorDirty } = require('./mirrorWorkspace');
const { truncateText } = require('./debugLog');

const DEFAULT_NETWORK_RETRY_ATTEMPTS = 5;
const MAX_NETWORK_RETRY_ATTEMPTS = 5;
const DEFAULT_NETWORK_RETRY_BASE_MS = 1000;

async function runCodexWithNetworkRetries({
  runner,
  runnerInput,
  env = process.env,
  emit = () => {},
  signal,
  canRetry = true,
  projectId,
  rootDir
}) {
  const maxAttempts = Math.min(
    parsePositiveInteger(env.CODEX_OVERLEAF_NETWORK_RETRY_ATTEMPTS) || DEFAULT_NETWORK_RETRY_ATTEMPTS,
    MAX_NETWORK_RETRY_ATTEMPTS
  );
  const baseDelayMs = parseNonNegativeInteger(env.CODEX_OVERLEAF_NETWORK_RETRY_BASE_MS)
    ?? DEFAULT_NETWORK_RETRY_BASE_MS;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfAborted(signal);
    try {
      return await runner(runnerInput);
    } catch (error) {
      const retryable = canRetry
        && attempt < maxAttempts
        && isTransientCodexNetworkError(error);
      if (!retryable) {
        throw error;
      }

      const collected = await collectMirrorChangesDetailed({ projectId, rootDir });
      const hasLocalChanges = Boolean(collected.changes?.length || collected.unsupportedChanges?.length);
      if (hasLocalChanges) {
        markMirrorDirty({
          projectId,
          rootDir,
          reason: 'codex_run_failed_with_local_changes'
        });
        emitRetryEvent(emit, 'codex.session.retry_skipped', 'Network retry skipped because the local workspace changed', {
          attempt,
          maxAttempts,
          changedCount: collected.changes?.length || 0,
          unsupportedCount: collected.unsupportedChanges?.length || 0
        }, 'failed');
        throw error;
      }

      const delayMs = baseDelayMs * (2 ** (attempt - 1));
      emitRetryEvent(emit, 'codex.session.retry', `Transient Codex network failure; retrying session (${attempt + 1}/${maxAttempts})`, {
        attempt,
        nextAttempt: attempt + 1,
        maxAttempts,
        delayMs,
        error: truncateText(error?.message || String(error), 500)
      });
      await waitForRetryDelay(delayMs, signal);
    }
  }
  throw new Error('Codex network retry loop exhausted unexpectedly');
}

function isTransientCodexNetworkError(error = {}) {
  const message = String(error?.message || error || '');
  if (/\b(?:401|403)\b|invalid api key|unauthori[sz]ed|forbidden|unsupported model/i.test(message)) {
    return false;
  }
  return /\b(?:408|429|502|503|504)\b|bad gateway|gateway timeout|service unavailable|econnreset|econnrefused|etimedout|socket hang up|stream disconnected|connection (?:failed|reset|refused|closed)|error sending request|fetch failed/i.test(message);
}

function emitRetryEvent(emit, type, title, detail, status = 'running') {
  emit({ type, title, detail, status, timestamp: new Date().toISOString() });
}

function waitForRetryDelay(delayMs, signal) {
  if (!delayMs) {
    throwIfAborted(signal);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(getAbortReason(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function parseNonNegativeInteger(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw getAbortReason(signal);
  }
}

function getAbortReason(signal) {
  if (signal?.reason instanceof Error) {
    return signal.reason;
  }
  const error = new Error('Codex run was cancelled by the user');
  error.code = 'codex_cancelled';
  return error;
}

module.exports = {
  isTransientCodexNetworkError,
  runCodexWithNetworkRetries
};