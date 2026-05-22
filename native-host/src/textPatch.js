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

function countNonEmptyLines(text) {
  const value = String(text ?? '');
  let count = 0;
  for (const line of value.split('\n')) {
    if (line.trim() !== '') {
      count += 1;
    }
  }
  return count;
}

function countSentenceTerminators(text) {
  const value = String(text ?? '');
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '。' || char === '？' || char === '！') {
      count += 1;
      continue;
    }
    if (char === '.' || char === '?' || char === '!') {
      if (
        char === '.'
        && /[0-9]/.test(value[index - 1] || '')
        && /[0-9]/.test(value[index + 1] || '')
      ) {
        // Decimal point inside a number such as `1.23` is not a boundary.
        continue;
      }
      count += 1;
    }
  }
  return count;
}

function hasOriginalMarkerLine(text) {
  return String(text ?? '')
    .split('\n')
    .some(line => /^\s*%\s*\[original\]\s*$/.test(line));
}

function hasLaterRevisedMarkerLine(text) {
  const lines = String(text ?? '').split('\n');
  const originalIndex = lines.findIndex(line => /^\s*%\s*\[original\]\s*$/.test(line));
  if (originalIndex === -1) {
    return false;
  }
  return lines.some((line, index) => (
    index > originalIndex && /^\s*%\s*\[revised\]\s*$/.test(line)
  ));
}

function hasAnyAnnotatedMarker(text) {
  return String(text ?? '')
    .split('\n')
    .some(line => (
      /^\s*%\s*\[original\]\s*$/.test(line) || /^\s*%\s*\[revised\]\s*$/.test(line)
    ));
}

function splitParagraphs(text) {
  const value = String(text ?? '');
  const separator = /\n\s*\n/g;
  const segments = [];
  let lastIndex = 0;
  let match = separator.exec(value);

  while (match) {
    segments.push({ text: value.slice(lastIndex, match.index), start: lastIndex });
    segments.push({ text: match[0], start: match.index });
    lastIndex = match.index + match[0].length;
    match = separator.exec(value);
  }
  segments.push({ text: value.slice(lastIndex), start: lastIndex });

  return segments;
}

// Lowercase abbreviations whose trailing `.` is conservatively NOT a sentence
// boundary. The word ending in the dot is matched case-insensitively, so this
// also covers `Fig.`, `Eq.`, `No.`, etc.
const NON_TERMINAL_ABBREVIATIONS = new Set([
  'e.g', 'i.e', 'cf', 'vs', 'etc', 'al', 'fig', 'figs', 'eq', 'eqs', 'sec',
  'secs', 'thm', 'lem', 'def', 'prop', 'cor', 'ref', 'no', 'vol', 'pp',
  'ch', 'app', 'resp', 'approx', 'mr', 'ms', 'mrs', 'dr', 'prof', 'st'
]);

function isLatexCommandStart(text, index) {
  return text[index] === '\\' && /[A-Za-z@]/.test(text[index + 1] || '');
}

// True when the contiguous non-whitespace run containing `index` looks like a
// URL (has a scheme such as `https://`, or starts with `www.`). A `.` inside
// such a run is never a confident sentence boundary.
function isInsideUrl(text, index) {
  let runStart = index;
  while (runStart > 0 && !/\s/.test(text[runStart - 1])) {
    runStart -= 1;
  }
  let runEnd = index;
  while (runEnd < text.length && !/\s/.test(text[runEnd])) {
    runEnd += 1;
  }
  const run = text.slice(runStart, runEnd);
  return /:\/\//.test(run) || /^www\./i.test(run);
}

// True when the `.` at `index` completes a known abbreviation such as `e.g.`
// or `Fig.` rather than ending a sentence.
function completesAbbreviation(text, index) {
  let wordStart = index;
  while (wordStart > 0 && /[A-Za-z.]/.test(text[wordStart - 1])) {
    wordStart -= 1;
  }
  const word = text.slice(wordStart, index).toLowerCase();
  return word.length > 0 && NON_TERMINAL_ABBREVIATIONS.has(word);
}

// True when the ASCII terminator `.` `?` `!` at `index` is a confident
// sentence boundary: it must be followed by whitespace, end-of-string, or a
// LaTeX command boundary, and must not sit inside a decimal number, a URL, or
// a known abbreviation.
function isConfidentAsciiBoundary(text, index) {
  const next = text[index + 1];
  const followedByBoundary = next === undefined
    || /\s/.test(next)
    || isLatexCommandStart(text, index + 1);
  if (!followedByBoundary) {
    return false;
  }
  if (text[index] === '.') {
    const prev = text[index - 1];
    if (/[0-9]/.test(prev || '') && /[0-9]/.test(next || '')) {
      // Decimal point inside a number such as `1.23`.
      return false;
    }
    if (isInsideUrl(text, index)) {
      return false;
    }
    if (completesAbbreviation(text, index)) {
      return false;
    }
  }
  return true;
}

// Splits `text` into ordered sentence spans `[{text, start, end}]` that
// partition the input exactly (concatenated they equal `text`). Each span
// includes its trailing terminator and the whitespace up to the next
// sentence. Conservative: when no confident boundary is found the whole input
// is returned as a single span.
function splitSentences(text) {
  const value = String(text ?? '');
  if (value.length === 0) {
    return [{ text: '', start: 0, end: 0 }];
  }

  const spans = [];
  let spanStart = 0;
  let index = 0;

  while (index < value.length) {
    const char = value[index];
    let isBoundary = false;

    if (char === '。' || char === '？' || char === '！') {
      // CJK terminators are unambiguous: they never appear in decimals, URLs,
      // or LaTeX command names, so they always end a sentence.
      isBoundary = true;
    } else if (char === '.' || char === '?' || char === '!') {
      isBoundary = isConfidentAsciiBoundary(value, index);
    }

    if (isBoundary) {
      // Absorb trailing whitespace up to the next sentence into this span.
      let spanEnd = index + 1;
      while (spanEnd < value.length && /\s/.test(value[spanEnd])) {
        spanEnd += 1;
      }
      if (spanEnd < value.length) {
        spans.push({
          text: value.slice(spanStart, spanEnd),
          start: spanStart,
          end: spanEnd
        });
        spanStart = spanEnd;
        index = spanEnd;
        continue;
      }
    }

    index += 1;
  }

  spans.push({
    text: value.slice(spanStart),
    start: spanStart,
    end: value.length
  });

  return spans;
}

function computeGroupMetrics(group, tokenPatches) {
  const oldNonEmptyLineCount = countNonEmptyLines(group.oldText);
  const newNonEmptyLineCount = countNonEmptyLines(group.newText);

  return {
    oldNonEmptyLineCount,
    newNonEmptyLineCount,
    maxNonEmptyLineCount: Math.max(oldNonEmptyLineCount, newNonEmptyLineCount),
    changedSpanChars: Math.max(group.oldText.length, group.newText.length),
    tokenPatchCount: tokenPatches === null ? null : tokenPatches.length,
    totalTokenChangedChars: tokenPatches === null
      ? null
      : tokenPatches.reduce((sum, patch) => (
          sum + Math.max(patch.to - patch.from, patch.insert.length)
        ), 0),
    oldSentenceTerminatorCount: countSentenceTerminators(group.oldText),
    newSentenceTerminatorCount: countSentenceTerminators(group.newText)
  };
}

module.exports = {
  computeTextPatches,
  computeLineAnchoredChangeGroups,
  computeGroupMetrics,
  splitParagraphs,
  splitSentences,
  hasOriginalMarkerLine,
  hasLaterRevisedMarkerLine,
  hasAnyAnnotatedMarker,
  countNonEmptyLines,
  countSentenceTerminators
};
