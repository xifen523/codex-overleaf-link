(function initCodexOverleafRunController(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodexOverleafRunController = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function runControllerFactory() {
  'use strict';

  const DEFAULT_EXPECTED_MIRROR_FRESHNESS_MS = 5 * 60 * 1000;

  function buildCodexRunParams({
    currentProjectId,
    state = {},
    task,
    project,
    useExistingMirror,
    fileOverlays,
    focusFiles,
    otWarmStart,
    codexThreadId,
    customInstructions,
    compileLogContext,
    submittedMode,
    restrictToFocusFiles
  } = {}) {
    const normalizedCustomInstructions = String(customInstructions || '').trim();
    const params = {
      projectId: currentProjectId,
      mode: submittedMode || state.mode,
      task,
      project: useExistingMirror ? undefined : project,
      useExistingMirror: useExistingMirror || undefined,
      fileOverlays: useExistingMirror ? fileOverlays : undefined,
      expectedMirrorFreshness: useExistingMirror ? DEFAULT_EXPECTED_MIRROR_FRESHNESS_MS : undefined,
      otWarmStart: useExistingMirror && otWarmStart ? true : undefined,
      warmStartStrategy: useExistingMirror && otWarmStart ? 'ot-warm-mirror' : undefined,
      focusFiles,
      restrictToFocusFiles: restrictToFocusFiles || undefined,
      model: state.model,
      reasoningEffort: state.reasoningEffort,
      speedTier: state.speedTier,
      session: state.session,
      threadId: codexThreadId || undefined,
      customInstructions: normalizedCustomInstructions || undefined
    };

    if (compileLogContext?.available) {
      params.compileLog = compileLogContext.log;
      params.compileErrors = compileLogContext.errors || [];
      params.compileWarnings = compileLogContext.warnings || [];
      params.compileLogFresh = compileLogContext.fresh;
      params.compileLogCompiledAt = compileLogContext.compiledAt;
    }

    return params;
  }

  function buildSessionHistoryResult({ assistantMessage = '', syncOutcome = {}, syncChanges = [], locale = 'zh' } = {}) {
    const parts = [];
    const finalAnswer = truncateSessionHistoryText(assistantMessage, 1600);
    if (finalAnswer) {
      parts.push(finalAnswer);
    }

    const changedFiles = Array.from(new Set((syncChanges || [])
      .map(change => change?.path)
      .filter(Boolean)));
    if (changedFiles.length) {
      const visibleFiles = changedFiles.slice(0, 8).join(', ');
      parts.push(locale === 'en'
        ? `Files changed: ${visibleFiles}${changedFiles.length > 8 ? ' and more' : ''}`
        : `涉及文件：${visibleFiles}${changedFiles.length > 8 ? ' 等' : ''}`);
    }

    if (!parts.length) {
      return truncateSessionHistoryText(syncOutcome.summaryLine || 'completed', 1600);
    }
    return truncateSessionHistoryText(parts.join('\n'), 2000);
  }

  function truncateSessionHistoryText(value, maxLength) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length <= maxLength) {
      return text;
    }
    return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
  }

  function canUseFocusedPartialSnapshot({
    project = {},
    snapshotWarnings = {},
    focusFiles = [],
    isUsableProjectFileContent = defaultIsUsableProjectFileContent
  } = {}) {
    const blocking = Array.isArray(snapshotWarnings.blocking) ? snapshotWarnings.blocking : [];
    if (!blocking.length || !blocking.some(isFullSnapshotWarning)) {
      return false;
    }
    const normalizedFocusFiles = normalizeFocusFiles(focusFiles);
    if (!normalizedFocusFiles.length) {
      return false;
    }
    if (project?.capabilities?.fullProjectSnapshot !== false) {
      return false;
    }

    const textFilesByPath = new Map((project.files || [])
      .filter(file => file && typeof file.path === 'string' && typeof file.content === 'string')
      .map(file => [normalizeFocusPath(file.path), file]));

    return normalizedFocusFiles.every(filePath => {
      const file = textFilesByPath.get(normalizeFocusPath(filePath));
      return file && isUsableProjectFileContent(file.content);
    });
  }

  function shouldRestrictWritebackToFocus({ focusFiles = [] } = {}) {
    return normalizeFocusFiles(focusFiles).length > 0;
  }

  function isFullSnapshotWarning(warning) {
    return /Full project snapshot was not captured/i.test(String(warning || ''));
  }

  function normalizeFocusFiles(value) {
    const seen = new Set();
    const files = [];
    for (const item of Array.isArray(value) ? value : []) {
      const filePath = normalizeFocusPath(item);
      if (!filePath || seen.has(filePath)) {
        continue;
      }
      seen.add(filePath);
      files.push(filePath);
    }
    return files;
  }

  function normalizeFocusPath(value) {
    return String(value || '')
      .replace(/^@file:/i, '')
      .replace(/\\/g, '/')
      .trim()
      .replace(/^\/+/, '');
  }

  function defaultIsUsableProjectFileContent(content) {
    return String(content || '').trim().length > 0;
  }

  return {
    buildCodexRunParams,
    canUseFocusedPartialSnapshot,
    shouldRestrictWritebackToFocus,
    buildSessionHistoryResult,
    truncateSessionHistoryText
  };
});
