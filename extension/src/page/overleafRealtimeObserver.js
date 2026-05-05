(function initOverleafRealtimeObserver(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(root);
  } else {
    root.CodexOverleafRealtimeObserver = factory(root);
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function overleafRealtimeObserverFactory(root) {
  'use strict';

  const STRATEGY_ACTIVE_EDITOR = 'active-editor';
  const CHANNEL_ROOT_NAMES = ['overleaf', 'Overleaf', '_ide', 'OL'];
  const CHANNEL_KEY_PATTERN = /socket|websocket|channel|realtime|collab|share|ot|doc|editor|connection|event|broadcast|presence/i;
  const SENSITIVE_KEY_PATTERN = /^(content|previousContent|nextContent|text|body|raw|rawContent|source|sourceText)$/i;

  function create(deps = {}) {
    const pageWindow = deps.window || getDefaultWindow();
    const pageDocument = deps.document || getDefaultDocument();
    const events = [];
    let activePath = '';
    let lastContent = '';
    let running = false;
    let listenerAttached = false;
    let statusName = 'off';
    let statusReason = '';
    let lastEventAt = null;
    let lastErrorCode = '';
    let channelCandidates = [];

    function start(_params = {}) {
      running = true;
      channelCandidates = collectChannelCandidates(pageWindow);
      refreshActiveBaseline();
      attachInputListener();
      return getStatus();
    }

    function stop() {
      if (listenerAttached && pageDocument && typeof pageDocument.removeEventListener === 'function') {
        pageDocument.removeEventListener('input', handleEditorInput, true);
      }
      listenerAttached = false;
      running = false;
      statusName = 'off';
      statusReason = '';
      return getStatus();
    }

    function getStatus() {
      const status = {
        status: statusName,
        running,
        strategy: STRATEGY_ACTIVE_EDITOR,
        activePath,
        queuedEventCount: events.length,
        lastEventAt,
        lastErrorCode,
        channelCandidates: cloneChannelCandidates(channelCandidates)
      };
      if (statusName === 'unavailable' && statusReason) {
        status.reason = statusReason;
      }
      return status;
    }

    function drainEvents() {
      const drained = events.slice();
      events.length = 0;
      return drained;
    }

    function attachInputListener() {
      if (listenerAttached) {
        return;
      }
      if (!pageDocument || typeof pageDocument.addEventListener !== 'function') {
        markUnavailable('missing_document');
        return;
      }
      pageDocument.addEventListener('input', handleEditorInput, true);
      listenerAttached = true;
    }

    function refreshActiveBaseline() {
      const nextPath = readActivePath();
      if (!nextPath) {
        activePath = '';
        lastContent = '';
        markUnavailable('missing_active_path');
        return false;
      }
      activePath = nextPath;
      lastContent = readEditorText();
      markObserving();
      return true;
    }

    function handleEditorInput() {
      if (!running) {
        return;
      }

      const nextPath = readActivePath();
      if (!nextPath) {
        activePath = '';
        lastContent = '';
        markUnavailable('missing_active_path');
        return;
      }

      const nextContent = readEditorText();
      if (nextPath !== activePath) {
        activePath = nextPath;
        lastContent = nextContent;
        markObserving();
        return;
      }

      if (nextContent === lastContent) {
        markObserving();
        return;
      }

      const observedAt = new Date(resolveNow()).toISOString();
      const otText = resolveOtText(deps, pageWindow, root);
      if (!otText || typeof otText.normalizeObservedTextEvent !== 'function') {
        lastContent = nextContent;
        markUnavailable('missing_ot_text');
        return;
      }

      const event = otText.normalizeObservedTextEvent({
        path: activePath,
        previousContent: lastContent,
        nextContent,
        observedAt,
        source: STRATEGY_ACTIVE_EDITOR
      });
      if (event && event.ok === true) {
        events.push(event);
        lastEventAt = event.observedAt || observedAt;
        markObserving();
      } else {
        lastErrorCode = event?.reason || 'normalize_observed_text_event_failed';
      }
      lastContent = nextContent;
    }

    function readActivePath() {
      if (typeof deps.getActiveFilePath !== 'function') {
        return '';
      }
      try {
        return normalizePath(deps.getActiveFilePath());
      } catch (_error) {
        markUnavailable('read_active_path_failed');
        return '';
      }
    }

    function readEditorText() {
      if (typeof deps.readActiveEditorText !== 'function') {
        markUnavailable('missing_editor_reader');
        return '';
      }
      try {
        return String(deps.readActiveEditorText() ?? '');
      } catch (_error) {
        markUnavailable('read_active_editor_failed');
        return '';
      }
    }

    function resolveNow() {
      if (typeof deps.now !== 'function') {
        return Date.now();
      }
      const value = deps.now();
      return Number.isFinite(Number(value)) ? Number(value) : Date.now();
    }

    function markObserving() {
      statusName = 'observing';
      statusReason = '';
      lastErrorCode = '';
    }

    function markUnavailable(reason) {
      statusName = 'unavailable';
      statusReason = reason;
      lastErrorCode = reason;
    }

    return {
      drainEvents,
      getStatus,
      start,
      stop
    };
  }

  function collectChannelCandidates(pageWindow) {
    if (!pageWindow || typeof pageWindow !== 'object') {
      return [];
    }

    const candidates = [];
    for (const rootName of CHANNEL_ROOT_NAMES) {
      const descriptor = getDescriptor(pageWindow, rootName);
      const value = descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
        ? descriptor.value
        : undefined;
      if (!isInspectableObject(value)) {
        continue;
      }

      const keyPaths = collectCandidateKeyPaths(value);
      if (keyPaths.length) {
        candidates.push({
          root: rootName,
          keyPaths
        });
      }
    }
    return candidates;
  }

  function collectCandidateKeyPaths(value) {
    const seen = typeof WeakSet === 'function' ? new WeakSet() : null;
    const keyPaths = [];
    walk(value, '', 0);
    return Array.from(new Set(keyPaths)).slice(0, 80);

    function walk(current, prefix, depth) {
      if (!isInspectableObject(current) || depth > 2) {
        return;
      }
      if (seen) {
        if (seen.has(current)) {
          return;
        }
        seen.add(current);
      }
      if (isDomLikeObject(current)) {
        return;
      }

      const descriptors = getDescriptors(current);
      for (const key of Object.keys(descriptors)) {
        const descriptor = descriptors[key];
        const keyPath = prefix ? `${prefix}.${key}` : key;
        if (isChannelCandidateKey(key)) {
          keyPaths.push(keyPath);
        }
        if (depth < 2 && descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
          walk(descriptor.value, keyPath, depth + 1);
        }
      }
    }
  }

  function isChannelCandidateKey(key) {
    return key.length <= 80
      && !SENSITIVE_KEY_PATTERN.test(key)
      && CHANNEL_KEY_PATTERN.test(key);
  }

  function getDescriptor(value, key) {
    try {
      return Object.getOwnPropertyDescriptor(value, key) || null;
    } catch (_error) {
      return null;
    }
  }

  function getDescriptors(value) {
    try {
      return Object.getOwnPropertyDescriptors(value);
    } catch (_error) {
      return {};
    }
  }

  function cloneChannelCandidates(candidates) {
    return candidates.map(candidate => ({
      root: candidate.root,
      keyPaths: candidate.keyPaths.slice()
    }));
  }

  function isInspectableObject(value) {
    return Boolean(value && typeof value === 'object');
  }

  function isDomLikeObject(value) {
    return Boolean(value
      && (value.nodeType
        || value.ownerDocument
        || typeof value.querySelectorAll === 'function'
        || typeof value.addEventListener === 'function'));
  }

  function normalizePath(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .replace(/\\/g, '/')
      .trim()
      .replace(/^\/+/, '');
  }

  function getDefaultWindow() {
    if (typeof window !== 'undefined') {
      return window;
    }
    return root || {};
  }

  function getDefaultDocument() {
    if (typeof document !== 'undefined') {
      return document;
    }
    return null;
  }

  function resolveOtText(deps, pageWindow, rootObject) {
    if (deps.otText) {
      return deps.otText;
    }
    if (pageWindow?.CodexOverleafOtText) {
      return pageWindow.CodexOverleafOtText;
    }
    if (rootObject?.CodexOverleafOtText) {
      return rootObject.CodexOverleafOtText;
    }
    if (typeof require === 'function') {
      try {
        return require('../shared/otText');
      } catch (_error) {
        return null;
      }
    }
    return null;
  }

  return {
    collectChannelCandidates,
    create
  };
});
