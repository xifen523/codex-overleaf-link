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

function computeLineAnchoredChangeGroups(oldValue, newValue) {
  const oldParts = splitTextParts(oldValue);
  const newParts = splitTextParts(newValue);
  const MAX_PARTS = 5000;
  const MAX_PRODUCT = 4000000;

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
  const groups = [];
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

  return groups;

  function flushGroup() {
    if (!group) {
      return;
    }
    groups.push(group);
    group = null;
  }
}

function computeLineAnchoredPatches(oldValue, newValue) {
  const groups = computeLineAnchoredChangeGroups(oldValue, newValue);
  const patches = [];

  for (const group of groups) {
    if (group.oldText !== group.newText) {
      const tokenPatches = computeTokenAnchoredPatches(group.oldText, group.newText, group.oldStart);
      if (tokenPatches) {
        patches.push(...tokenPatches);
      } else {
        patches.push(computeSingleTextPatch(group.oldText, group.newText, group.oldStart));
      }
    }
  }

  return patches;
}

function computeTokenAnchoredPatches(oldValue, newValue, offset = 0) {
  const MAX_GROUP_CHARS = 20000;
  const MAX_TOKENS = 3000;
  const MAX_PRODUCT = 4000000;
  const MAX_PATCHES = 80;

  if (
    oldValue.length > MAX_GROUP_CHARS
    || newValue.length > MAX_GROUP_CHARS
  ) {
    return null;
  }

  const oldTokens = splitTextTokens(oldValue);
  const newTokens = splitTextTokens(newValue);
  if (
    oldTokens.length === 0
    || newTokens.length === 0
    || oldTokens.length > MAX_TOKENS
    || newTokens.length > MAX_TOKENS
    || oldTokens.length * newTokens.length > MAX_PRODUCT
  ) {
    return null;
  }

  const edits = computePartEdits(
    oldTokens.map(token => token.text),
    newTokens.map(token => token.text)
  );
  const patches = [];
  let oldOffset = 0;
  let newOffset = 0;
  let group = null;

  for (const edit of edits) {
    if (edit.type === 'equal') {
      flushGroup();
      oldOffset = oldTokens[edit.oldIndex].end;
      newOffset = newTokens[edit.newIndex].end;
      continue;
    }

    if (!group) {
      group = {
        oldStart: oldOffset,
        newStart: newOffset,
        oldEnd: oldOffset,
        newEnd: newOffset
      };
    }

    if (edit.type === 'remove') {
      group.oldEnd = oldTokens[edit.oldIndex].end;
      oldOffset = group.oldEnd;
    } else if (edit.type === 'add') {
      group.newEnd = newTokens[edit.newIndex].end;
      newOffset = group.newEnd;
    }
  }
  flushGroup();

  if (!patches.length || patches.length > MAX_PATCHES) {
    return null;
  }
  return patches;

  function flushGroup() {
    if (!group) {
      return;
    }
    const oldText = oldValue.slice(group.oldStart, group.oldEnd);
    const newText = newValue.slice(group.newStart, group.newEnd);
    if (oldText !== newText) {
      patches.push({
        from: offset + group.oldStart,
        to: offset + group.oldEnd,
        expected: oldText,
        insert: newText
      });
    }
    group = null;
  }
}

function splitTextTokens(text) {
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    const start = index;
    const char = text[index];
    if (/\s/.test(char)) {
      index += 1;
      while (index < text.length && /\s/.test(text[index])) {
        index += 1;
      }
    } else if (char === '\\') {
      index += 1;
      if (index < text.length && /[A-Za-z@]/.test(text[index])) {
        while (index < text.length && /[A-Za-z@]/.test(text[index])) {
          index += 1;
        }
      } else if (index < text.length) {
        index += 1;
      }
    } else if (/[A-Za-z0-9_]/.test(char)) {
      index += 1;
      while (index < text.length && /[A-Za-z0-9_]/.test(text[index])) {
        index += 1;
      }
    } else {
      index += 1;
      while (
        index < text.length
        && !/\s/.test(text[index])
        && text[index] !== '\\'
        && !/[A-Za-z0-9_]/.test(text[index])
      ) {
        index += 1;
      }
    }
    tokens.push({
      text: text.slice(start, index),
      start,
      end: index
    });
  }
  return tokens;
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
  computeTextPatches,
  computeLineAnchoredChangeGroups
};
