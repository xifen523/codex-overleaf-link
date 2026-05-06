(function initAuditRecords(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodexOverleafAuditRecords = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function auditRecordsFactory() {
  'use strict';

  const MAX_SUMMARY_CHARS = 240;

  function buildAuditDraftRecord(input = {}) {
    const now = new Date().toISOString();
    return {
      id: input.id || generateId('aud'),
      projectId: stringField(input.projectId),
      sessionId: stringField(input.sessionId),
      turnId: stringField(input.turnId),
      createdAt: stringField(input.createdAt) || now,
      completedAt: '',
      mode: stringField(input.mode),
      model: stringField(input.model),
      reasoningEffort: stringField(input.reasoningEffort),
      speedTier: stringField(input.speedTier),
      promptSummary: summarizePrompt(input.promptSummary || input.task || input.prompt),
      focusFiles: normalizePathList(input.focusFiles),
      selectedSkillIds: normalizeStringList(input.selectedSkillIds),
      sensitiveFindings: normalizeSensitiveFindings(input.sensitiveFindings),
      changedFiles: [],
      diffSummary: normalizeDiffSummary(input.diffSummary),
      blockedFiles: [],
      appliedFiles: [],
      skippedFiles: [],
      resultStatus: 'draft',
      saveVerification: normalizeObjectSummary(input.saveVerification)
    };
  }

  function buildAuditFinalRecord(input = {}) {
    const draft = input.draft && typeof input.draft === 'object' ? input.draft : {};
    return Object.assign({}, draft, {
      completedAt: stringField(input.completedAt) || new Date().toISOString(),
      changedFiles: normalizeFileSummaries(input.changedFiles),
      diffSummary: normalizeDiffSummary(input.diffSummary),
      blockedFiles: normalizeFileSummaries(input.blockedFiles),
      appliedFiles: normalizeFileSummaries(input.appliedFiles),
      skippedFiles: normalizeFileSummaries(input.skippedFiles),
      resultStatus: stringField(input.resultStatus) || 'completed',
      saveVerification: normalizeObjectSummary(input.saveVerification)
    });
  }

  function buildDiagnosticBundle(input = {}) {
    return {
      createdAt: new Date().toISOString(),
      compatibility: redactContent(input.compatibility),
      platform: redactContent(input.platform),
      nativeEnvironment: redactContent(input.nativeEnvironment),
      mirror: summarizeMirror(input.mirror),
      auditLogs: normalizeAuditLogList(input.auditLogs),
      run: summarizeRun(input.run),
      governance: summarizeGovernance(input.governance),
      projectIdHash: hashString(stringField(input.projectId))
    };
  }

  function normalizeAuditLogRecord(input = {}) {
    return {
      id: stringField(input.id) || generateId('aud'),
      projectId: stringField(input.projectId),
      sessionId: stringField(input.sessionId),
      turnId: stringField(input.turnId),
      createdAt: stringField(input.createdAt) || new Date().toISOString(),
      completedAt: stringField(input.completedAt),
      mode: stringField(input.mode),
      model: stringField(input.model),
      reasoningEffort: stringField(input.reasoningEffort),
      speedTier: stringField(input.speedTier),
      promptSummary: summarizePrompt(input.promptSummary),
      focusFiles: normalizePathList(input.focusFiles),
      selectedSkillIds: normalizeStringList(input.selectedSkillIds),
      sensitiveFindings: normalizeSensitiveFindings(input.sensitiveFindings),
      changedFiles: normalizeFileSummaries(input.changedFiles),
      diffSummary: normalizeDiffSummary(input.diffSummary),
      blockedFiles: normalizeFileSummaries(input.blockedFiles),
      appliedFiles: normalizeFileSummaries(input.appliedFiles),
      skippedFiles: normalizeFileSummaries(input.skippedFiles),
      resultStatus: stringField(input.resultStatus) || 'draft',
      saveVerification: normalizeObjectSummary(input.saveVerification)
    };
  }

  function normalizeSensitiveFindings(findings) {
    return (Array.isArray(findings) ? findings : []).map(finding => ({
      detectorId: stringField(finding.detectorId),
      path: stringField(finding.path),
      source: stringField(finding.source),
      preview: summarizePrompt(finding.preview)
    })).map(removeEmptyFields);
  }

  function normalizeFileSummaries(files) {
    return (Array.isArray(files) ? files : []).map(file => {
      if (typeof file === 'string') {
        return { path: file };
      }
      return removeEmptyFields({
        path: stringField(file && file.path),
        destinationPath: stringField(file && file.destinationPath),
        type: stringField(file && file.type),
        reason: stringField(file && file.reason),
        status: stringField(file && file.status),
        size: Number.isFinite(Number(file && file.size)) ? Number(file.size) : undefined
      });
    });
  }

  function normalizeDiffSummary(summary = {}) {
    const result = {};
    for (const key of ['filesChanged', 'additions', 'deletions', 'binaryFilesChanged']) {
      if (Object.prototype.hasOwnProperty.call(summary, key)) {
        result[key] = nonNegativeInteger(summary[key]);
      }
    }
    return result;
  }

  function normalizeObjectSummary(value) {
    if (!value || typeof value !== 'object') {
      return null;
    }
    return redactContent(value);
  }

  function normalizeAuditLogList(records) {
    return (Array.isArray(records) ? records : []).map(normalizeAuditLogRecord);
  }

  function summarizeMirror(mirror = {}) {
    return redactContent({
      status: mirror.status,
      rootStatus: mirror.rootStatus,
      fileCount: Array.isArray(mirror.files) ? mirror.files.length : mirror.fileCount,
      skippedCount: Array.isArray(mirror.skippedFiles) ? mirror.skippedFiles.length : mirror.skippedCount,
      errorCode: mirror.errorCode
    });
  }

  function summarizeRun(run = {}) {
    return {
      id: stringField(run.id),
      status: stringField(run.status),
      errorCode: stringField(run.errorCode),
      events: (Array.isArray(run.events) ? run.events : []).map(event => removeEmptyFields({
        title: stringField(event.title),
        status: stringField(event.status),
        errorCode: stringField(event.errorCode),
        kind: stringField(event.kind)
      }))
    };
  }

  function summarizeGovernance(rules = {}) {
    return {
      readonlyPatternCount: Array.isArray(rules.readonlyPatterns) ? rules.readonlyPatterns.length : 0,
      writablePatternCount: Array.isArray(rules.writablePatterns) ? rules.writablePatterns.length : 0,
      sensitiveCheckEnabled: rules.sensitiveCheckEnabled === true,
      sensitiveConfirmAllowed: rules.sensitiveConfirmAllowed === true
    };
  }

  function redactContent(value) {
    if (Array.isArray(value)) {
      return value.map(redactContent);
    }
    if (!value || typeof value !== 'object') {
      return value;
    }

    const result = {};
    for (const key of Object.keys(value)) {
      if (isContentKey(key)) {
        continue;
      }
      result[key] = redactContent(value[key]);
    }
    return result;
  }

  function isContentKey(key) {
    return /^(content|body|prompt|task|diff|fullDiff|compileLog|fileBody|text)$/i.test(key);
  }

  function normalizePathList(paths) {
    return normalizeStringList(paths).map(path => path.replace(/\\/g, '/').replace(/^\/+/, ''));
  }

  function normalizeStringList(values) {
    const seen = new Set();
    const result = [];
    for (const value of Array.isArray(values) ? values : []) {
      const text = stringField(value).trim();
      if (!text || seen.has(text)) {
        continue;
      }
      seen.add(text);
      result.push(text);
    }
    return result;
  }

  function summarizePrompt(value) {
    const text = stringField(value).replace(/\s+/g, ' ').trim();
    if (text.length <= MAX_SUMMARY_CHARS) {
      return text;
    }
    return text.slice(0, MAX_SUMMARY_CHARS - 1) + '…';
  }

  function stringField(value) {
    return typeof value === 'string' ? value : '';
  }

  function nonNegativeInteger(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
  }

  function removeEmptyFields(value) {
    const result = {};
    for (const key of Object.keys(value)) {
      if (value[key] !== undefined && value[key] !== '') {
        result[key] = value[key];
      }
    }
    return result;
  }

  function hashString(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function generateId(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  return {
    buildAuditDraftRecord,
    buildAuditFinalRecord,
    buildDiagnosticBundle,
    normalizeAuditLogRecord,
    normalizeSensitiveFindings,
    normalizeFileSummaries,
    normalizeDiffSummary,
    redactContent,
    hashString
  };
});
