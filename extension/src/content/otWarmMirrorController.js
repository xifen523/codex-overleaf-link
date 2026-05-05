(function initCodexOverleafOtWarmMirrorController(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodexOverleafOtWarmMirrorController = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function otWarmMirrorControllerFactory() {
  'use strict';

  const OT_POLL_INTERVAL_MS = 1000;
  const OT_PATCH_DEBOUNCE_MS = 500;
  const OT_MAX_PATCH_BATCH = 25;
  const PAUSE_STATES = new Set(['running', 'writing', 'undoing', 'compiling']);

  function buildPatchFilesRequest({ projectId, events } = {}) {
    const files = [];
    for (const event of Array.isArray(events) ? events : []) {
      if (files.length >= OT_MAX_PATCH_BATCH) {
        break;
      }
      const filePath = normalizePath(event?.path);
      if (!filePath || typeof event?.baseHash !== 'string' || !event.baseHash.trim()) {
        continue;
      }
      if (typeof event.nextContent !== 'string') {
        continue;
      }

      const file = {
        path: filePath,
        baseHash: event.baseHash,
        nextContent: event.nextContent
      };
      if (Object.prototype.hasOwnProperty.call(event, 'observedVersion')) {
        file.observedVersion = event.observedVersion;
      }
      if (Object.prototype.hasOwnProperty.call(event, 'observedAt')) {
        file.observedAt = event.observedAt;
      }
      files.push(file);
    }

    return {
      method: 'mirror.patchFiles',
      params: {
        projectId,
        source: 'ot',
        files
      }
    };
  }

  function shouldPauseOtWarmMirror(state) {
    const reason = getPauseStateName(state);
    if (PAUSE_STATES.has(reason)) {
      return { pause: true, reason };
    }
    return { pause: false };
  }

  function canUseOtWarmStart({ enabled, focusFiles, mirrorStatus } = {}) {
    if (!enabled) {
      return { ok: false, reason: 'disabled' };
    }
    if (!mirrorStatus || mirrorStatus.exists !== true) {
      return { ok: false, reason: 'mirror_missing' };
    }

    const normalizedFocusFiles = normalizePaths(focusFiles);
    if (!normalizedFocusFiles.length) {
      return { ok: false, reason: 'no_focus_files' };
    }

    const freshFiles = new Set();
    for (const file of Array.isArray(mirrorStatus.otFreshFiles) ? mirrorStatus.otFreshFiles : []) {
      if (file?.state !== 'fresh') {
        continue;
      }
      const filePath = normalizePath(file.path);
      if (filePath) {
        freshFiles.add(filePath);
      }
    }

    if (normalizedFocusFiles.every(filePath => freshFiles.has(filePath))) {
      return { ok: true, reason: 'ot_focus_fresh' };
    }
    return { ok: false, reason: 'ot_focus_not_fresh' };
  }

  function normalizePath(value) {
    return String(value ?? '')
      .trim()
      .replace(/^@file:/i, '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/\/+/g, '/')
      .replace(/^\/+/, '');
  }

  function normalizePaths(value) {
    const seen = new Set();
    const paths = [];
    for (const item of Array.isArray(value) ? value : []) {
      const filePath = normalizePath(item);
      if (!filePath || seen.has(filePath)) {
        continue;
      }
      seen.add(filePath);
      paths.push(filePath);
    }
    return paths;
  }

  function getPauseStateName(state) {
    if (typeof state === 'string') {
      return state;
    }
    if (!state || typeof state !== 'object') {
      return '';
    }
    for (const key of ['status', 'state', 'phase', 'mode']) {
      if (typeof state[key] === 'string') {
        return state[key];
      }
    }
    for (const pauseState of PAUSE_STATES) {
      if (state[pauseState] === true) {
        return pauseState;
      }
    }
    return '';
  }

  return {
    OT_POLL_INTERVAL_MS,
    OT_PATCH_DEBOUNCE_MS,
    OT_MAX_PATCH_BATCH,
    buildPatchFilesRequest,
    canUseOtWarmStart,
    normalizePath,
    normalizePaths,
    shouldPauseOtWarmMirror
  };
});
