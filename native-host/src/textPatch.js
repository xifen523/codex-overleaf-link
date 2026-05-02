'use strict';

function computeTextPatches(oldText, newText) {
  const oldValue = String(oldText ?? '');
  const newValue = String(newText ?? '');
  if (oldValue === newValue) {
    return [];
  }

  const linePatches = computeLineAnchoredPatches(oldValue, newValue);
  if (linePatches.length) {
    return linePatches;
  }

  return [computeSingleTextPatch(oldValue, newValue)];
}

function computeSingleTextPatch(oldValue, newValue, offset = 0) {
  let prefixLength = 0;
  const sharedLength = Math.min(oldValue.length, newValue.length);
  while (prefixLength < sharedLength && oldValue[prefixLength] === newValue[prefixLength]) {
    prefixLength += 1;
  }

  let oldEnd = oldValue.length;
  let newEnd = newValue.length;
  while (
    oldEnd > prefixLength
    && newEnd > prefixLength
    && oldValue[oldEnd - 1] === newValue[newEnd - 1]
  ) {
    oldEnd -= 1;
    newEnd -= 1;
  }

  return {
    from: offset + prefixLength,
    to: offset + oldEnd,
    expected: oldValue.slice(prefixLength, oldEnd),
    insert: newValue.slice(prefixLength, newEnd)
  };
}

function computeLineAnchoredPatches(oldValue, newValue) {
  const oldParts = splitTextParts(oldValue);
  const newParts = splitTextParts(newValue);
  const MAX_PARTS = 1000;
  const MAX_PRODUCT = 1000000;

  if (
    oldParts.length === 0
    || newParts.length === 0
    || oldParts.length > MAX_PARTS
    || newParts.length > MAX_PARTS
    || oldParts.length * newParts.length > MAX_PRODUCT
  ) {
    return [];
  }

  const edits = computePartEdits(oldParts, newParts);
  const patches = [];
  let oldOffset = 0;
  let newOffset = 0;
  let group = null;

  for (const edit of edits) {
    if (edit.type === 'equal') {
      flushGroup();
      oldOffset += oldParts[edit.oldIndex].length;
      newOffset += newParts[edit.newIndex].length;
      continue;
    }

    if (!group) {
      group = {
        oldStart: oldOffset,
        oldText: '',
        newText: ''
      };
    }

    if (edit.type === 'remove') {
      const text = oldParts[edit.oldIndex];
      group.oldText += text;
      oldOffset += text.length;
    } else if (edit.type === 'add') {
      const text = newParts[edit.newIndex];
      group.newText += text;
      newOffset += text.length;
    }
  }
  flushGroup();

  return patches;

  function flushGroup() {
    if (!group) {
      return;
    }
    if (group.oldText !== group.newText) {
      patches.push(computeSingleTextPatch(group.oldText, group.newText, group.oldStart));
    }
    group = null;
  }
}

function splitTextParts(text) {
  return String(text || '').match(/[^\n]*\n|[^\n]+/g) || [];
}

function computePartEdits(oldParts, newParts) {
  const n = oldParts.length;
  const m = newParts.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = oldParts[i] === newParts[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const edits = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldParts[i] === newParts[j]) {
      edits.push({ type: 'equal', oldIndex: i, newIndex: j });
      i += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      edits.push({ type: 'remove', oldIndex: i });
      i += 1;
      continue;
    } else {
      edits.push({ type: 'add', newIndex: j });
    }
    j += 1;
  }
  while (i < n) {
    edits.push({ type: 'remove', oldIndex: i });
    i += 1;
  }
  while (j < m) {
    edits.push({ type: 'add', newIndex: j });
    j += 1;
  }
  return edits;
}

module.exports = {
  computeTextPatches
};
