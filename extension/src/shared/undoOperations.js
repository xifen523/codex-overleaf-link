(function initUndoOperations(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodexOverleafUndoOperations = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function undoOperationsFactory() {
  'use strict';

  function buildUndoOperations(project, appliedOperations) {
    const workingFilesByPath = new Map();
    for (const file of project?.files || []) {
      if (typeof file?.path === 'string' && typeof file.content === 'string') {
        workingFilesByPath.set(file.path, file.content);
      }
    }

    const undo = [];
    const fullRestoreEditPaths = new Set();

    for (const operation of appliedOperations || []) {
      if (!operation || typeof operation.type !== 'string') {
        continue;
      }

      if (operation.type === 'edit') {
        if (!operation.path || !workingFilesByPath.has(operation.path)) {
          continue;
        }
        const currentBeforeEdit = workingFilesByPath.get(operation.path);
        if (!fullRestoreEditPaths.has(operation.path)) {
          const inversePatches = buildInverseTextPatches(currentBeforeEdit, operation.patches);
          if (inversePatches.length) {
            undo.push(normalizeUndoOperation({
              type: 'edit',
              path: operation.path,
              patches: inversePatches,
              reason: 'Undo edit'
            }));
          } else {
            fullRestoreEditPaths.add(operation.path);
            undo.push(normalizeUndoOperation({
              type: 'edit',
              path: operation.path,
              replaceAll: currentBeforeEdit,
              reason: 'Undo edit'
            }));
          }
        }
      } else if (operation.type === 'create') {
        if (!operation.path) {
          continue;
        }
        undo.push(normalizeUndoOperation({
          type: 'delete',
          path: operation.path,
          reason: 'Undo create'
        }));
      } else if (operation.type === 'rename') {
        if (!operation.path || !operation.to) {
          continue;
        }
        undo.push(normalizeUndoOperation({
          type: 'rename',
          path: operation.to,
          to: operation.path,
          reason: 'Undo rename'
        }));
      } else if (operation.type === 'move') {
        if (!operation.path || !operation.to) {
          continue;
        }
        undo.push(normalizeUndoOperation({
          type: 'move',
          path: operation.to,
          to: operation.path,
          reason: 'Undo move'
        }));
      } else if (operation.type === 'delete') {
        if (!operation.path || !workingFilesByPath.has(operation.path)) {
          continue;
        }
        undo.push(normalizeUndoOperation({
          type: 'create',
          path: operation.path,
          content: workingFilesByPath.get(operation.path),
          reason: 'Undo delete'
        }));
      }

      applyOperationToFiles(workingFilesByPath, operation);
    }

    return undo.reverse();
  }

  function buildInverseTextPatches(textBeforeEdit, patches) {
    if (!Array.isArray(patches) || !patches.length) {
      return [];
    }
    const normalized = normalizeTextPatches(patches, String(textBeforeEdit || '').length);
    if (!normalized.ok) {
      return [];
    }
    const applied = applyTextPatches(textBeforeEdit, normalized.patches);
    if (!applied.ok) {
      return [];
    }

    let offset = 0;
    return normalized.patches.map(patch => {
      const from = patch.from + offset;
      const to = from + patch.insert.length;
      offset += patch.insert.length - (patch.to - patch.from);
      return {
        from,
        to,
        expected: patch.insert,
        insert: patch.expected
      };
    });
  }

  function buildUndoCheckpoint(project, appliedOperations) {
    const undoOperations = buildUndoOperations(project, appliedOperations);
    const expectedFiles = buildExpectedFilesAfterOperations(project, appliedOperations);
    return {
      undoOperations,
      undoBaseFiles: filesMapToList(selectUndoBaseFiles(expectedFiles, undoOperations))
    };
  }

  function buildExpectedFilesAfterOperations(project, appliedOperations) {
    const filesByPath = new Map();
    for (const file of project?.files || []) {
      if (typeof file?.path === 'string' && typeof file.content === 'string') {
        filesByPath.set(file.path, file.content);
      }
    }

    for (const operation of appliedOperations || []) {
      applyOperationToFiles(filesByPath, operation);
    }

    return filesByPath;
  }

  function applyOperationToFiles(filesByPath, operation) {
    if (!operation || typeof operation.type !== 'string' || !operation.path) {
      return;
    }

    if (operation.type === 'edit') {
      const current = filesByPath.get(operation.path);
      if (typeof current !== 'string') {
        return;
      }
      if (typeof operation.replaceAll === 'string') {
        filesByPath.set(operation.path, operation.replaceAll);
      } else if (Array.isArray(operation.patches) && operation.patches.length) {
        const patched = applyTextPatches(current, operation.patches);
        if (patched.ok) {
          filesByPath.set(operation.path, patched.text);
        }
      } else if (typeof operation.find === 'string' && typeof operation.replace === 'string') {
        filesByPath.set(operation.path, current.split(operation.find).join(operation.replace));
      }
    } else if (operation.type === 'create') {
      filesByPath.set(operation.path, operation.content || '');
    } else if (operation.type === 'rename' || operation.type === 'move') {
      if (!operation.to || !filesByPath.has(operation.path)) {
        return;
      }
      const content = filesByPath.get(operation.path);
      filesByPath.delete(operation.path);
      filesByPath.set(operation.to, content);
    } else if (operation.type === 'delete') {
      filesByPath.delete(operation.path);
    }
  }

  function filesMapToList(filesByPath) {
    return Array.from(filesByPath.entries()).map(([path, content]) => ({
      path,
      content
    }));
  }

  function selectUndoBaseFiles(expectedFilesByPath, undoOperations) {
    const neededPaths = new Set();
    for (const operation of undoOperations || []) {
      if (!operation?.path) {
        continue;
      }
      if (operation.type === 'edit' || operation.type === 'delete' || operation.type === 'rename' || operation.type === 'move') {
        neededPaths.add(operation.path);
      }
    }

    const selected = new Map();
    for (const [path, content] of expectedFilesByPath.entries()) {
      if (neededPaths.has(path)) {
        selected.set(path, content);
      }
    }
    return selected;
  }

  function normalizeUndoOperation(operation) {
    const normalized = {
      type: operation.type,
      path: operation.path,
      to: operation.to ?? null,
      find: null,
      replace: null,
      replaceAll: operation.replaceAll ?? null,
      content: operation.content ?? null,
      reason: operation.reason || null
    };
    if (Array.isArray(operation.patches) && operation.patches.length) {
      normalized.patches = operation.patches.map(patch => ({
        from: patch.from,
        to: patch.to,
        expected: String(patch.expected ?? ''),
        insert: String(patch.insert ?? '')
      }));
    }
    return normalized;
  }

  function applyTextPatches(text, patches) {
    const normalized = normalizeTextPatches(patches, text.length);
    if (!normalized.ok) {
      return normalized;
    }

    let next = text;
    for (const patch of normalized.patches.slice().sort((left, right) => right.from - left.from)) {
      if (next.slice(patch.from, patch.to) !== patch.expected) {
        return {
          ok: false,
          reason: 'Patch expected text did not match'
        };
      }
      next = next.slice(0, patch.from) + patch.insert + next.slice(patch.to);
    }
    return {
      ok: true,
      text: next
    };
  }

  function normalizeTextPatches(patches, length) {
    const normalized = [];
    let previousTo = 0;
    for (const rawPatch of patches || []) {
      const from = Number(rawPatch?.from);
      const to = Number(rawPatch?.to);
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > length) {
        return {
          ok: false,
          reason: 'Invalid patch range'
        };
      }
      if (from < previousTo) {
        return {
          ok: false,
          reason: 'Overlapping patch ranges'
        };
      }
      previousTo = to;
      normalized.push({
        from,
        to,
        expected: String(rawPatch.expected ?? ''),
        insert: String(rawPatch.insert ?? '')
      });
    }
    return {
      ok: true,
      patches: normalized
    };
  }

  return {
    buildUndoCheckpoint,
    buildExpectedFilesAfterOperations,
    buildUndoOperations
  };
});
