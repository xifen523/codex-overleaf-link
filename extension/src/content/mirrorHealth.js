(function initCodexOverleafMirrorHealth(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodexOverleafMirrorHealth = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function mirrorHealthFactory() {
  'use strict';

  const MIRROR_REUSE_MAX_AGE_MS = 5 * 60 * 1000;
  const MIRROR_FRESH_LABEL_MS = 60 * 1000;
  const MIRROR_STALE_LABEL_MS = 5 * 60 * 1000;
  const PREFETCH_DEBOUNCE_MS = 1200;
  const PREFETCH_SUCCESS_COOLDOWN_MS = 30 * 1000;
  const PREFETCH_ERROR_RETENTION_MS = 10 * 60 * 1000;

  function classifyMirrorHealth(status = {}) {
    if (status.exists !== true) {
      return {
        state: 'missing',
        exists: false,
        ageMs: null,
        reusable: false
      };
    }

    const ageMs = normalizeAgeMs(status.ageMs);
    const reusable = ageMs < MIRROR_REUSE_MAX_AGE_MS;
    if (ageMs <= MIRROR_FRESH_LABEL_MS) {
      return {
        state: 'fresh',
        exists: true,
        ageMs,
        reusable
      };
    }
    return {
      state: 'stale',
      exists: true,
      ageMs,
      reusable
    };
  }

  function shouldStartPrefetch(state = {}) {
    if (state.busy === true || state.inFlight) {
      return { ok: false, reason: 'busy' };
    }

    const now = normalizeTimestamp(state.now, 0);
    if (isWithinWindow(now, state.lastAttemptAt, PREFETCH_DEBOUNCE_MS)) {
      return { ok: false, reason: 'debounced' };
    }
    if (isWithinWindow(now, state.lastSuccessAt, PREFETCH_SUCCESS_COOLDOWN_MS)) {
      return { ok: false, reason: 'success_cooldown' };
    }
    if (isWithinWindow(now, state.lastErrorAt, PREFETCH_ERROR_RETENTION_MS)) {
      return { ok: false, reason: 'error_retained' };
    }

    return { ok: true };
  }

  function normalizeAgeMs(value) {
    const ageMs = Number(value);
    return Number.isFinite(ageMs) && ageMs >= 0 ? ageMs : Infinity;
  }

  function normalizeTimestamp(value, fallback) {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) ? timestamp : fallback;
  }

  function isWithinWindow(now, startedAt, windowMs) {
    const timestamp = Number(startedAt);
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      return false;
    }
    return now - timestamp < windowMs;
  }

  return {
    MIRROR_REUSE_MAX_AGE_MS,
    MIRROR_FRESH_LABEL_MS,
    MIRROR_STALE_LABEL_MS,
    PREFETCH_DEBOUNCE_MS,
    PREFETCH_SUCCESS_COOLDOWN_MS,
    PREFETCH_ERROR_RETENTION_MS,
    classifyMirrorHealth,
    shouldStartPrefetch
  };
});
