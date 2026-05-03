(function initCodexOverleafWritebackController(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodexOverleafWritebackController = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function writebackControllerFactory() {
  'use strict';

  function buildSyncApplyOperations(syncChanges = [], project = {}) {
    const existingPaths = new Set((project.files || []).map(file => file.path));
    return (syncChanges || []).map(change => {
      if (change.type === 'delete') {
        return {
          type: 'delete',
          path: change.path,
          reason: '本地 Codex workspace 删除了这个文件。'
        };
      }
      if (change.type === 'write' && existingPaths.has(change.path)) {
        const patches = getSyncChangePatches(change);
        if (patches.length) {
          return {
            type: 'edit',
            path: change.path,
            patches,
            reason: `同步本地 Codex workspace 中的局部文件改动（${patches.length} 处）。`
          };
        }
        return {
          type: 'edit',
          path: change.path,
          replaceAll: String(change.content ?? ''),
          reason: '同步本地 Codex workspace 中的文件内容。'
        };
      }
      return {
        type: 'create',
        path: change.path,
        content: change.content || '',
        reason: '同步本地 Codex workspace 中的新文件。'
      };
    }).filter(operation => operation.path);
  }

  function getSyncChangePatches(change = {}) {
    const normalized = normalizeTextPatches(change.patches);
    if (normalized.length) {
      return normalized;
    }
    if (typeof change.previousContent === 'string' && typeof change.content === 'string') {
      return computeSingleTextPatch(change.previousContent, change.content);
    }
    return [];
  }

  function normalizeTextPatches(patches) {
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
    return normalized.sort((left, right) => left.from - right.from);
  }

  function computeSingleTextPatch(oldText, newText) {
    if (oldText === newText) {
      return [];
    }
    let prefix = 0;
    const sharedLength = Math.min(oldText.length, newText.length);
    while (prefix < sharedLength && oldText[prefix] === newText[prefix]) {
      prefix += 1;
    }

    let oldEnd = oldText.length;
    let newEnd = newText.length;
    while (oldEnd > prefix && newEnd > prefix && oldText[oldEnd - 1] === newText[newEnd - 1]) {
      oldEnd -= 1;
      newEnd -= 1;
    }

    return [
      {
        from: prefix,
        to: oldEnd,
        expected: oldText.slice(prefix, oldEnd),
        insert: newText.slice(prefix, newEnd)
      }
    ];
  }

  function getAppliedOperationPaths(applied = {}) {
    return Array.from(new Set((applied.applied || [])
      .map(item => item?.operation?.path)
      .filter(Boolean)));
  }

  function mergeVerifiedAppliedFiles(freshProject = {}, originalProject = {}, applied = {}) {
    const filesByPath = new Map((freshProject.files || []).map(file => [file.path, { ...file }]));
    const originalByPath = new Map((originalProject.files || []).map(file => [file.path, file]));

    for (const item of applied.applied || []) {
      const operation = item?.operation || {};
      const result = item?.result || {};
      if (!operation.path) {
        continue;
      }

      if (operation.type === 'delete') {
        filesByPath.delete(operation.path);
        continue;
      }

      if ((operation.type === 'rename' || operation.type === 'move') && operation.to) {
        const previous = filesByPath.get(operation.path) || originalByPath.get(operation.path);
        filesByPath.delete(operation.path);
        filesByPath.set(operation.to, {
          ...(previous || {}),
          path: operation.to,
          kind: 'text',
          content: result.verifiedContent || previous?.content || '',
          source: 'verified-writeback'
        });
        continue;
      }

      if (operation.type === 'create') {
        filesByPath.set(operation.path, {
          path: operation.path,
          kind: 'text',
          content: result.verifiedContent || operation.content || '',
          source: 'verified-writeback'
        });
        continue;
      }

      if (operation.type === 'edit' && typeof result.verifiedContent === 'string') {
        filesByPath.set(operation.path, {
          ...(filesByPath.get(operation.path) || originalByPath.get(operation.path) || {}),
          path: operation.path,
          kind: 'text',
          content: result.verifiedContent,
          source: 'verified-writeback'
        });
      }
    }

    return {
      ...freshProject,
      files: Array.from(filesByPath.values())
    };
  }

  function formatUnsupportedLocalChangeSummary(changes = []) {
    if (!changes.length) {
      return '';
    }
    const visibleChanges = changes.slice(0, 5);
    const lines = [
      'Codex 在本地生成了这些文件，但插件没有同步回 Overleaf：',
      ...visibleChanges.map(change => `- ${change.path || '未命名文件'}：${formatUnsupportedLocalChangeReason(change.reason)}`)
    ];
    if (changes.length > visibleChanges.length) {
      lines.push(`另外 ${changes.length - visibleChanges.length} 个文件未显示。`);
    }
    return lines.join('\n');
  }

  function formatUnsupportedLocalChangeReason(reason) {
    if (reason === 'generated_artifact') {
      return 'LaTeX 构建产物，默认不写回。';
    }
    if (reason === 'unsupported_non_text_file') {
      return '非文本文件，暂不支持自动写回。';
    }
    return '当前类型暂不支持自动写回。';
  }

  function getAppliedSyncChanges(syncChanges = [], applied = {}) {
    const appliedPaths = new Set((applied.applied || [])
      .map(item => item.operation?.path || item.operation?.to || item.operation?.from)
      .filter(Boolean));
    return (syncChanges || []).filter(change => appliedPaths.has(change.path));
  }

  return {
    buildSyncApplyOperations,
    computeSingleTextPatch,
    formatUnsupportedLocalChangeSummary,
    getAppliedOperationPaths,
    getAppliedSyncChanges,
    getSyncChangePatches,
    mergeVerifiedAppliedFiles,
    normalizeTextPatches
  };
});
