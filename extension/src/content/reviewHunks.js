(function initCodexOverleafReviewHunks(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodexOverleafReviewHunks = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function reviewHunksFactory() {
  'use strict';

  function buildReviewModel(syncChanges = [], options = {}) {
    const files = [];
    const hunks = [];

    for (const [changeIndex, change] of (syncChanges || []).entries()) {
      const path = normalizePath(change?.path);
      if (!path) {
        continue;
      }

      const file = {
        index: changeIndex,
        type: change?.type,
        path,
        decisionKey: normalizeReviewDecisionKey(path),
        reviewable: false,
        hunks: []
      };

      if (isHunkReviewableChange(change, options)) {
        file.reviewable = true;
        file.hunks = normalizePatches(change.patches).map((patch, patchIndex) => {
          const id = `${path}:hunk:${patchIndex}`;
          return {
            id,
            path,
            patchIndexes: [patchIndex],
            startOffset: patch.from,
            endOffset: patch.to,
            startLine: getPatchStartLine(change, patchIndex),
            lineCount: getPatchLineCount(patch),
            canApplyIndependently: true,
            truncated: false,
            decisionKey: normalizeReviewDecisionKey(path, id)
          };
        });
        hunks.push(...file.hunks);
      }

      files.push(file);
    }

    return {
      files,
      hunks
    };
  }

  function buildAcceptedSyncChanges(syncChanges = [], decisions = {}) {
    const model = buildReviewModel(syncChanges);
    const filesByIndex = new Map(model.files.map(file => [file.index, file]));
    const accepted = [];

    for (const [changeIndex, change] of (syncChanges || []).entries()) {
      const file = filesByIndex.get(changeIndex);
      if (!file) {
        continue;
      }

      if (!file.reviewable) {
        if (isAcceptedDecision(decisions[file.decisionKey])) {
          accepted.push(cloneSyncChange(change));
        }
        continue;
      }

      const acceptedPatchIndexes = [];
      for (const hunk of file.hunks) {
        if (isAcceptedDecision(decisions[hunk.decisionKey])) {
          acceptedPatchIndexes.push(...hunk.patchIndexes);
        }
      }

      if (acceptedPatchIndexes.length) {
        const patches = normalizePatches(change.patches)
          .filter((patch, patchIndex) => acceptedPatchIndexes.includes(patchIndex));
        const clone = cloneSyncChange(change);
        clone.patches = patches.map(patch => ({ ...patch }));
        delete clone.replaceAll;
        accepted.push(clone);
      }
    }

    return accepted;
  }

  function summarizeReviewModel(model = {}) {
    const files = Array.isArray(model.files) ? model.files : [];
    return {
      files: files.length,
      hunks: files.reduce((count, file) => count + (Array.isArray(file.hunks) ? file.hunks.length : 0), 0),
      fallbackFiles: files.filter(file => !file.reviewable).length,
      reviewableFiles: files.filter(file => file.reviewable).length
    };
  }

  function normalizeReviewDecisionKey(path, hunkId) {
    const normalizedPath = normalizePath(path);
    return `${normalizedPath || 'unknown'}::${hunkId || 'file'}`;
  }

  function isHunkReviewableChange(change = {}, options = {}) {
    if (change.type !== 'write') {
      return false;
    }
    if (hasTruncatedDisplayDiff(change)) {
      return false;
    }
    const patches = Array.isArray(change.patches) ? change.patches : [];
    if (!patches.length) {
      return false;
    }
    return normalizePatches(patches).length === patches.length;
  }

  function hasTruncatedDisplayDiff(change = {}) {
    if (!Array.isArray(change.diff)) {
      return false;
    }
    return change.diff.some(hunk => hunk?.truncated === true);
  }

  function normalizePatches(patches = []) {
    const normalized = [];
    for (const patch of patches || []) {
      const from = Number(patch?.from);
      const to = Number(patch?.to);
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) {
        continue;
      }
      normalized.push({
        from,
        to,
        expected: String(patch.expected ?? ''),
        insert: String(patch.insert ?? '')
      });
    }
    return normalized;
  }

  function getPatchStartLine(change = {}, patchIndex = 0) {
    const diffHunk = Array.isArray(change.diff) ? change.diff[patchIndex] : null;
    const startB = Number(diffHunk?.startB);
    if (Number.isInteger(startB) && startB > 0) {
      return startB;
    }
    return undefined;
  }

  function getPatchLineCount(patch = {}) {
    const text = String(patch.insert ?? patch.expected ?? '');
    if (!text) {
      return 1;
    }
    return Math.max(1, text.split('\n').length);
  }

  function normalizePath(path) {
    return String(path || '').replace(/\\/g, '/').trim().replace(/^\/+/, '');
  }

  function isAcceptedDecision(decision) {
    return decision === true || decision === 'accepted' || decision === 'accept';
  }

  function isRejectedDecision(decision) {
    return decision === false || decision === 'rejected' || decision === 'reject';
  }

  // v1.7.5: summaries of what the user rejected during review, so the
  // completion report can offer a one-click "redo the rejected changes"
  // retry that quotes the location and a snippet of each dropped hunk.
  function buildRejectedHunkSummaries(syncChanges = [], decisions = {}) {
    const model = buildReviewModel(syncChanges);
    const filesByIndex = new Map(model.files.map(file => [file.index, file]));
    const rejected = [];
    for (const [changeIndex, change] of (syncChanges || []).entries()) {
      const file = filesByIndex.get(changeIndex);
      if (!file) {
        continue;
      }
      if (!file.reviewable) {
        if (isRejectedDecision(decisions[file.decisionKey])) {
          rejected.push({ path: file.path, summary: '' });
        }
        continue;
      }
      const patches = normalizePatches(change.patches);
      for (const hunk of file.hunks) {
        if (!isRejectedDecision(decisions[hunk.decisionKey])) {
          continue;
        }
        const patch = patches[hunk.patchIndexes[0]] || {};
        const snippet = String(patch.insert || '').trim().replace(/\s+/g, ' ').slice(0, 80);
        rejected.push({
          path: file.path,
          summary: `${hunk.startLine ? `L${hunk.startLine}` : ''}${hunk.startLine && snippet ? ': ' : ''}${snippet}`
        });
      }
    }
    return rejected;
  }

  function cloneSyncChange(change) {
    if (!change || typeof change !== 'object') {
      return change;
    }
    const clone = { ...change };
    if (Array.isArray(change.diff)) {
      clone.diff = cloneArrayObjects(change.diff);
    }
    if (Array.isArray(change.patches)) {
      clone.patches = cloneArrayObjects(change.patches);
    }
    return clone;
  }

  function cloneArrayObjects(items) {
    return items.map(item => {
      if (!item || typeof item !== 'object') {
        return item;
      }
      const clone = { ...item };
      if (Array.isArray(item.lines)) {
        clone.lines = cloneArrayObjects(item.lines);
      }
      return clone;
    });
  }

  return {
    buildAcceptedSyncChanges,
    buildRejectedHunkSummaries,
    buildReviewModel,
    normalizeReviewDecisionKey,
    summarizeReviewModel
  };
});
