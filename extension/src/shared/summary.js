(function initSummary(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodexOverleafSummary = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function summaryFactory() {
  'use strict';

  const HIGH_RISK_TYPES = ['delete', 'overwrite-binary', 'tracked-change-decision'];

  const TYPE_TO_COUNT_KEY = {
    edit: 'edit',
    create: 'create',
    rename: 'rename',
    move: 'move',
    delete: 'delete',
    'overwrite-binary': 'binaryOverwrite',
    'tracked-change-decision': 'trackedChangeDecision'
  };

  function emptyCounts() {
    return {
      edit: 0,
      create: 0,
      rename: 0,
      move: 0,
      delete: 0,
      binaryOverwrite: 0,
      trackedChangeDecision: 0
    };
  }

  function buildOperationSummary(operations) {
    const counts = emptyCounts();
    const affectedFiles = new Set();
    const deletePlan = [];

    for (const operation of operations || []) {
      const countKey = TYPE_TO_COUNT_KEY[operation.type];
      if (countKey) {
        counts[countKey] += 1;
      }

      addPath(affectedFiles, operation.path);
      addPath(affectedFiles, operation.to);

      if (operation.type === 'delete') {
        deletePlan.push({
          path: operation.path,
          reason: operation.reason || 'No reason provided'
        });
      }
    }

    return {
      counts,
      affectedFiles: Array.from(affectedFiles).sort(),
      deletePlan
    };
  }

  function splitDeletePlan(operations) {
    const immediate = [];
    const needsConfirmation = [];

    for (const operation of operations || []) {
      if (HIGH_RISK_TYPES.includes(operation.type)) {
        needsConfirmation.push(operation);
      } else {
        immediate.push(operation);
      }
    }

    return {
      immediate,
      needsConfirmation
    };
  }

  function buildChangeSummaryLine({
    notes = '',
    operations = [],
    summary,
    applyResults = [],
    status,
    deletePlanRejected = false
  } = {}) {
    if (status === 'rejected') {
      return 'Summary: proposed changes were rejected; no project files changed.';
    }

    const results = normalizeApplyResults(applyResults);
    const appliedOperations = collectAppliedOperations(results);
    const skippedCount = countSkippedOperations(results);
    const effectiveSummary = results.length > 0
      ? buildOperationSummary(appliedOperations)
      : normalizeSummary(summary) || buildOperationSummary(operations);

    const changePhrase = describeCounts(effectiveSummary.counts);
    const note = firstUsefulSentence(notes);
    const segments = [`Summary: ${changePhrase}`];
    const affectedFiles = formatAffectedFiles(effectiveSummary.affectedFiles);

    if (affectedFiles && changePhrase !== 'no project files changed') {
      segments[0] += ` (${affectedFiles})`;
    }

    if (changePhrase === 'no project files changed' && note) {
      segments.push(note);
    }

    if (deletePlanRejected) {
      segments.push('delete plan was not applied');
    }

    if (skippedCount > 0) {
      segments.push(`${skippedCount} ${pluralize('operation', skippedCount)} skipped`);
    }

    return ensureTerminalPeriod(segments.join('; '));
  }

  function addPath(paths, filePath) {
    if (typeof filePath === 'string' && filePath.length > 0) {
      paths.add(filePath);
    }
  }

  function normalizeApplyResults(applyResults) {
    if (!applyResults) {
      return [];
    }
    return Array.isArray(applyResults) ? applyResults.filter(Boolean) : [applyResults];
  }

  function collectAppliedOperations(applyResults) {
    const operations = [];
    for (const result of applyResults) {
      for (const item of result.applied || []) {
        if (item?.operation) {
          operations.push(item.operation);
        }
      }
    }
    return operations;
  }

  function countSkippedOperations(applyResults) {
    return applyResults.reduce((count, result) => count + (result.skipped?.length || 0), 0);
  }

  function hasSkippedApplyOperations(applyResults) {
    return countSkippedOperations(normalizeApplyResults(applyResults)) > 0;
  }

  function normalizeSummary(summary) {
    if (!summary?.counts) {
      return null;
    }
    return {
      counts: {
        ...emptyCounts(),
        ...summary.counts
      },
      affectedFiles: Array.isArray(summary.affectedFiles) ? summary.affectedFiles : [],
      deletePlan: Array.isArray(summary.deletePlan) ? summary.deletePlan : []
    };
  }

  function describeCounts(counts = emptyCounts()) {
    const parts = [];
    addCountPart(parts, counts.edit, 'edited', 'file');
    addCountPart(parts, counts.create, 'created', 'file');
    addCountPart(parts, counts.rename, 'renamed', 'file');
    addCountPart(parts, counts.move, 'moved', 'file');
    addCountPart(parts, counts.delete, 'deleted', 'file');
    addCountPart(parts, counts.binaryOverwrite, 'overwrote', 'binary file');
    addCountPart(parts, counts.trackedChangeDecision, 'handled', 'tracked-change decision');

    return joinParts(parts) || 'no project files changed';
  }

  function addCountPart(parts, count, verb, noun) {
    if (count > 0) {
      parts.push(`${verb} ${count} ${pluralize(noun, count)}`);
    }
  }

  function joinParts(parts) {
    if (parts.length <= 1) {
      return parts[0] || '';
    }
    return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  }

  function pluralize(noun, count) {
    if (count === 1) {
      return noun;
    }
    if (noun.endsWith('y')) {
      return `${noun.slice(0, -1)}ies`;
    }
    return `${noun}s`;
  }

  function formatAffectedFiles(files = []) {
    const unique = Array.from(new Set(files.filter(file => typeof file === 'string' && file.length > 0))).sort();
    if (unique.length === 0) {
      return '';
    }
    if (unique.length <= 4) {
      return unique.join(', ');
    }
    return `${unique.slice(0, 4).join(', ')}, +${unique.length - 4} more`;
  }

  function firstUsefulSentence(text) {
    const compact = String(text || '').replace(/\s+/g, ' ').trim();
    if (!compact) {
      return '';
    }

    const match = compact.match(/^(.{1,220}?[.!?。！？])(?:\s|$)/);
    if (match) {
      return match[1];
    }

    return compact.length > 220 ? `${compact.slice(0, 217)}...` : compact;
  }

  function ensureTerminalPeriod(text) {
    return /[.!?。！？]$/.test(text) ? text : `${text}.`;
  }

  return {
    HIGH_RISK_TYPES,
    buildChangeSummaryLine,
    buildOperationSummary,
    hasSkippedApplyOperations,
    splitDeletePlan
  };
});
