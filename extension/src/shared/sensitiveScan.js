(function initSensitiveScan(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodexOverleafSensitiveScan = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function sensitiveScanFactory() {
  'use strict';

  const MAX_PREVIEW_CHARS = 96;
  const DETECTORS = [
    { id: 'private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/gi },
    { id: 'bearer-token', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi },
    { id: 'api-token', pattern: /\b(?:(?:ghp|github_pat|xox[baprs])_[A-Za-z0-9_=-]{16,}|sk-[A-Za-z0-9_-]{16,})\b/gi },
    { id: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
    { id: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
    { id: 'huggingface-token', pattern: /\bhf_[A-Za-z0-9]{20,}\b/g },
    { id: 'gitlab-token', pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
    { id: 'stripe-live-secret', pattern: /\bsk_live_[A-Za-z0-9]{16,}\b/g },
    { id: 'jwt-token', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
    {
      id: 'secret-assignment',
      pattern: /\b(?:api[_-]?key|token|secret|password|passwd)\b\s*[:=]\s*["']?[^"'\s,;]{4,}/gi
    }
  ];

  function scanSensitiveText(source, text, options = {}) {
    const content = typeof text === 'string' ? text : '';
    const findings = [];
    const seen = new Set();
    const sourceKey = typeof source === 'string' && source ? source : 'text';

    for (const detector of DETECTORS) {
      const pattern = new RegExp(detector.pattern.source, detector.pattern.flags);
      let match;
      while ((match = pattern.exec(content)) !== null) {
        // Include match.index so multiple distinct secrets of the same type in
        // one source (e.g. several keys in one .env) each count, instead of
        // collapsing to a single finding and under-reporting the "found N" total.
        const key = detector.id + ':' + sourceKey + ':' + (options.path || '') + ':' + match.index;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        findings.push({
          detectorId: detector.id,
          source: sourceKey,
          path: typeof options.path === 'string' ? options.path : undefined,
          preview: buildRedactedPreview(content, match.index, match[0])
        });
      }
    }

    return findings.map(removeUndefinedFields);
  }

  function scanSensitiveProjectFiles(files) {
    const findings = [];
    for (const file of Array.isArray(files) ? files : []) {
      const path = typeof file.path === 'string' ? file.path : '';
      const content = typeof file.content === 'string' ? file.content : '';
      const fileFindings = scanSensitiveText('project-file', content, { path });
      findings.push(...fileFindings);
    }
    return findings;
  }

  function scanSensitiveInputs(input = {}) {
    const findings = [];
    if (typeof input.task === 'string') {
      findings.push(...scanSensitiveText('task', input.task));
    }
    if (typeof input.prompt === 'string') {
      findings.push(...scanSensitiveText('prompt', input.prompt));
    }
    findings.push(...scanSensitiveProjectFiles(input.files));
    return findings;
  }

  function buildRedactedPreview(content, index, matchedText) {
    const lineStart = content.lastIndexOf('\n', index) + 1;
    const nextNewline = content.indexOf('\n', index);
    const lineEnd = nextNewline === -1 ? content.length : nextNewline;
    const line = content.slice(lineStart, lineEnd);
    const localIndex = Math.max(0, index - lineStart);
    const redacted = line.slice(0, localIndex) + '[REDACTED]' + line.slice(localIndex + matchedText.length);
    return trimPreview(redactPreviewLine(redacted).replace(/\s+/g, ' '));
  }

  function redactPreviewLine(line) {
    let redacted = String(line || '');
    for (const detector of DETECTORS) {
      const pattern = new RegExp(detector.pattern.source, detector.pattern.flags);
      redacted = redacted.replace(pattern, '[REDACTED]');
    }
    return redacted;
  }

  function trimPreview(value) {
    const text = String(value || '').trim();
    if (text.length <= MAX_PREVIEW_CHARS) {
      return text;
    }
    return text.slice(0, MAX_PREVIEW_CHARS - 1) + '…';
  }

  function removeUndefinedFields(value) {
    const result = {};
    for (const key of Object.keys(value)) {
      if (value[key] !== undefined) {
        result[key] = value[key];
      }
    }
    return result;
  }

  return {
    scanSensitiveText,
    scanSensitiveProjectFiles,
    scanSensitiveInputs
  };
});
