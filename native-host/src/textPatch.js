'use strict';

function computeTextPatches(oldText, newText) {
  const oldValue = String(oldText ?? '');
  const newValue = String(newText ?? '');
  if (oldValue === newValue) {
    return [];
  }

  const groups = computeLineAnchoredChangeGroups(oldValue, newValue);
  if (!groups.length) {
    return [computeSingleTextPatch(oldValue, newValue)];
  }

  const patches = [];
  for (const group of groups) {
    patches.push(...computeNaturalGroupPatches(group));
  }
  return patches.length ? patches : [computeSingleTextPatch(oldValue, newValue)];
}

// Computes the natural-granularity patches for one changed group (spec
// "Algorithm sketch"). Builds token patches and metrics, classifies the group,
// then dispatches to the matching builder. `singleGroupPatch` already returns
// a one-element array; `computeParagraphPatches` / `computeSentencePatches`
// return an array or `null`, so a null/empty result falls back to a single
// group patch. `coalesceTokenPatches` always returns a non-empty array when it
// receives non-empty token patches.
function computeNaturalGroupPatches(group) {
  const tokenPatches = computeTokenAnchoredPatches(
    group.oldText,
    group.newText,
    group.oldStart
  );
  const metrics = computeGroupMetrics(group, tokenPatches);
  const { type } = classifyChangedGroup(group, tokenPatches, metrics);

  if (type === 'annotated_block') {
    return singleGroupPatch(group);
  }
  if (type === 'paragraph_rewrite') {
    const paragraphPatches = computeParagraphPatches(group);
    return (paragraphPatches && paragraphPatches.length)
      ? paragraphPatches
      : singleGroupPatch(group);
  }
  if (type === 'sentence_rewrite') {
    const sentencePatches = computeSentencePatches(group, tokenPatches);
    return (sentencePatches && sentencePatches.length)
      ? sentencePatches
      : singleGroupPatch(group);
  }
  if (type === 'small_edit' && tokenPatches && tokenPatches.length) {
    return coalesceTokenPatches(group, tokenPatches);
  }
  return singleGroupPatch(group);
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

// Resolves the sentence-span quantities used by the `isSentenceRewrite`
// predicate (the design spec leaves them undefined). It segments the changed
// group's OLD text into sentence spans and checks whether every token patch's
// old range maps within a single span.
//
// Returns:
// - `fitsOneSpan`: true iff exactly one sentence span contains every token
//   patch's old range (relative to the group).
// - `spanChars` / `spanTokenCount`: the char length / token count of that
//   single span when `fitsOneSpan` is true; `0` otherwise (irrelevant then).
// - `spanStart` / `spanEnd`: the group-relative `[start,end)` offsets of that
//   single span when `fitsOneSpan` is true; `0` otherwise (irrelevant then).
//
// When `tokenPatches` is `null` or empty, `fitsOneSpan` is false.
function resolveTokenPatchSentenceSpan(group, tokenPatches) {
  const empty = {
    fitsOneSpan: false,
    spanChars: 0,
    spanTokenCount: 0,
    spanStart: 0,
    spanEnd: 0
  };
  if (tokenPatches === null || tokenPatches.length === 0) {
    return empty;
  }

  const sentenceSpans = splitSentences(group.oldText);
  let containingSpan = null;

  for (const span of sentenceSpans) {
    const containsEveryPatch = tokenPatches.every(patch => {
      const relativeFrom = patch.from - group.oldStart;
      const relativeTo = patch.to - group.oldStart;
      return relativeFrom >= span.start && relativeTo <= span.end;
    });
    if (!containsEveryPatch) {
      continue;
    }
    if (containingSpan !== null) {
      // More than one span contains every patch (possible for a zero-length
      // patch sitting on a span boundary). Not a confident single sentence.
      return empty;
    }
    containingSpan = span;
  }

  if (containingSpan === null) {
    return empty;
  }
  return {
    fitsOneSpan: true,
    spanChars: containingSpan.text.length,
    spanTokenCount: splitTextTokens(containingSpan.text).length,
    spanStart: containingSpan.start,
    spanEnd: containingSpan.end
  };
}

// Classifies a changed group into a natural review granularity. Pure function.
//
// `group` is `{oldStart, oldText, newText}`; `tokenPatches` is the array from
// `computeTokenAnchoredPatches(group.oldText, group.newText, group.oldStart)`
// or `null`; `metrics` is the object from `computeGroupMetrics(group,
// tokenPatches)`.
//
// Returns `{type}` where `type` is one of `annotated_block`,
// `paragraph_rewrite`, `sentence_rewrite`, `small_edit`, `fallback`. The
// predicates are evaluated in first-match order: annotated_block →
// paragraph_rewrite → sentence_rewrite → small_edit → fallback. When
// `tokenPatches === null`, every token-dependent predicate is false, so the
// only reachable results are `annotated_block`, `paragraph_rewrite` (via the
// line-count or sentence-terminator branch), and `fallback`.
function classifyChangedGroup(group, tokenPatches, metrics) {
  const newGroupText = group.newText;
  const {
    maxNonEmptyLineCount,
    changedSpanChars,
    tokenPatchCount,
    totalTokenChangedChars,
    oldSentenceTerminatorCount,
    newSentenceTerminatorCount
  } = metrics;

  const isAnnotatedBlock = hasOriginalMarkerLine(newGroupText)
    && hasLaterRevisedMarkerLine(newGroupText)
    && maxNonEmptyLineCount >= 3;
  if (isAnnotatedBlock) {
    return { type: 'annotated_block' };
  }

  const isDenseTokenRewrite = tokenPatches !== null
    && tokenPatchCount >= 6
    && changedSpanChars >= 160
    && tokenPatchCount / Math.max(1, maxNonEmptyLineCount) >= 2;

  const isParagraphRewrite = !isAnnotatedBlock
    && (
      maxNonEmptyLineCount >= 3
      || (oldSentenceTerminatorCount >= 2 && newSentenceTerminatorCount >= 2)
      || isDenseTokenRewrite
    );
  if (isParagraphRewrite) {
    return { type: 'paragraph_rewrite' };
  }

  const sentenceSpan = resolveTokenPatchSentenceSpan(group, tokenPatches);

  const isSentenceRewrite = !isAnnotatedBlock
    && !isParagraphRewrite
    && tokenPatches !== null
    && tokenPatchCount >= 3
    && sentenceSpan.fitsOneSpan
    && (sentenceSpan.spanChars >= 80 || sentenceSpan.spanTokenCount >= 12);
  if (isSentenceRewrite) {
    return { type: 'sentence_rewrite' };
  }

  const isSmallEdit = !isAnnotatedBlock
    && !isParagraphRewrite
    && !isSentenceRewrite
    && tokenPatches !== null
    && (
      tokenPatchCount <= 2
      || (
        totalTokenChangedChars < 80
        && maxNonEmptyLineCount <= 2
        && !hasAnyAnnotatedMarker(newGroupText)
      )
    );
  if (isSmallEdit) {
    return { type: 'small_edit' };
  }

  return { type: 'fallback' };
}

// The single-patch fallback for a whole changed group (spec algorithm sketch).
// Returns a one-element array so callers can treat every builder uniformly.
// The patch's `from`/`to` are absolute offsets into the full original text:
// `computeSingleTextPatch` adds `group.oldStart` to its segment-local offsets.
function singleGroupPatch(group) {
  return [computeSingleTextPatch(group.oldText, group.newText, group.oldStart)];
}

// Builds paragraph-level patches for a changed group (spec §4).
//
// Segments `group.oldText` and `group.newText` with `splitParagraphs`, which
// yields alternating [content, separator, content, ...] segments. When both
// sides share the SAME separator structure (same segment count and identical
// separator segments) the content paragraphs are paired positionally and one
// patch is emitted per changed pair, with `from`/`to` as absolute offsets
// (`group.oldStart` + the old paragraph segment's start). A single-paragraph
// group is the degenerate case of this rule: one pair, one patch.
//
// Returns `null` when pairing is ambiguous (separator counts differ or a
// separator segment changed), so the caller can fall back to a group patch.
function computeParagraphPatches(group) {
  const oldSegments = splitParagraphs(group.oldText);
  const newSegments = splitParagraphs(group.newText);

  if (oldSegments.length !== newSegments.length) {
    return null;
  }
  // splitParagraphs always yields an odd count: content at even indices,
  // blank-line separators at odd indices. Every separator must be unchanged
  // for positional pairing of the content paragraphs to be sound.
  for (let index = 1; index < oldSegments.length; index += 2) {
    if (oldSegments[index].text !== newSegments[index].text) {
      return null;
    }
  }

  const patches = [];
  for (let index = 0; index < oldSegments.length; index += 2) {
    const oldParagraph = oldSegments[index];
    const newParagraph = newSegments[index];
    if (oldParagraph.text === newParagraph.text) {
      continue;
    }
    patches.push(computeSingleTextPatch(
      oldParagraph.text,
      newParagraph.text,
      group.oldStart + oldParagraph.start
    ));
  }
  return patches;
}

// Builds a single sentence-level patch for a `sentence_rewrite` group (spec
// §5). Every token patch lies inside one confident sentence span `[a,b)` of
// `group.oldText`. Because all token changes are inside that span, the regions
// `group.oldText.slice(0,a)` and `group.oldText.slice(b)` are unchanged, so
// `group.newText` is `prefix + <new sentence> + suffix` with the same prefix
// and suffix; `<new sentence>` is derived by stripping them.
//
// Returns `[patch]` whose `from`/`to` cover only that old sentence span
// (absolute offsets), or `null` when the single span cannot be identified or
// the unchanged prefix/suffix do not actually match (defensive).
function computeSentencePatches(group, tokenPatches) {
  const span = resolveTokenPatchSentenceSpan(group, tokenPatches);
  if (!span.fitsOneSpan) {
    return null;
  }

  const { spanStart, spanEnd } = span;
  const oldPrefix = group.oldText.slice(0, spanStart);
  const oldSuffix = group.oldText.slice(spanEnd);
  const oldSentence = group.oldText.slice(spanStart, spanEnd);

  // The regions outside the sentence span must be byte-identical between old
  // and new text; otherwise a change leaked outside the span and a single
  // sentence patch would be wrong.
  if (
    !group.newText.startsWith(oldPrefix)
    || !group.newText.endsWith(oldSuffix)
    || group.newText.length < oldPrefix.length + oldSuffix.length
  ) {
    return null;
  }

  const newSentence = group.newText.slice(
    oldPrefix.length,
    group.newText.length - oldSuffix.length
  );
  return [computeSingleTextPatch(
    oldSentence,
    newSentence,
    group.oldStart + spanStart
  )];
}

// Short function words whose presence inside a coalescing gap does not block a
// merge. Combined with pure punctuation and whitespace, these define a gap
// that is "mostly" connective filler (spec §7).
const COALESCE_FILLER_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'nor', 'so', 'yet', 'of', 'to', 'in',
  'on', 'at', 'by', 'as', 'is', 'are', 'was', 'were', 'be', 'for', 'with',
  'that', 'this', 'it', 'its', 'we', 'our'
]);

// True when the gap text between two token patches is short connective filler:
// only whitespace, punctuation, and short function words. An empty gap counts
// as filler.
function isCoalesceFillerGap(gap) {
  if (gap.length > 40) {
    return false;
  }
  for (const token of splitTextTokens(gap)) {
    const text = token.text;
    if (/^\s+$/.test(text)) {
      continue;
    }
    if (!/[A-Za-z0-9]/.test(text)) {
      // Pure punctuation / symbols.
      continue;
    }
    if (COALESCE_FILLER_WORDS.has(text.toLowerCase())) {
      continue;
    }
    return false;
  }
  return true;
}

// Conservative safety-net coalescing of token patches (spec §7). Adjacent
// token patches are merged when they lie in the same sentence span of
// `group.oldText`, the gap between them is at most 40 chars of whitespace /
// punctuation / short function words, and that sentence span contains at
// least 3 token patches. A merged patch spans `[firstFrom, lastTo)` with
// `expected` the original slice and `insert` the merged inserts interleaved
// with the unchanged gap text. When nothing qualifies the token patches are
// returned unchanged. Absolute offsets are preserved throughout.
function coalesceTokenPatches(group, tokenPatches) {
  if (tokenPatches === null || tokenPatches.length < 3) {
    return tokenPatches;
  }

  const spans = splitSentences(group.oldText);
  // Index of the sentence span that fully contains a patch's group-relative
  // range, or -1 when it is not cleanly inside any single span.
  const spanOf = patch => {
    const relativeFrom = patch.from - group.oldStart;
    const relativeTo = patch.to - group.oldStart;
    return spans.findIndex(span => (
      relativeFrom >= span.start && relativeTo <= span.end
    ));
  };

  // Count patches per sentence span so the ">= 3 in the span" gate can be
  // checked before merging any run.
  const patchesPerSpan = new Map();
  for (const patch of tokenPatches) {
    const spanIndex = spanOf(patch);
    patchesPerSpan.set(spanIndex, (patchesPerSpan.get(spanIndex) || 0) + 1);
  }

  const result = [];
  let run = [];
  let runSpanIndex = -1;

  const flushRun = () => {
    if (run.length === 0) {
      return;
    }
    if (run.length === 1) {
      result.push(run[0]);
    } else {
      result.push(mergeTokenPatchRun(group, run));
    }
    run = [];
  };

  for (const patch of tokenPatches) {
    const spanIndex = spanOf(patch);
    const eligibleSpan = spanIndex !== -1 && patchesPerSpan.get(spanIndex) >= 3;

    if (run.length === 0) {
      run = eligibleSpan ? [patch] : [];
      runSpanIndex = eligibleSpan ? spanIndex : -1;
      if (!eligibleSpan) {
        result.push(patch);
      }
      continue;
    }

    const prev = run[run.length - 1];
    const gap = group.oldText.slice(
      prev.to - group.oldStart,
      patch.from - group.oldStart
    );
    const mergeable = eligibleSpan
      && spanIndex === runSpanIndex
      && isCoalesceFillerGap(gap);

    if (mergeable) {
      run.push(patch);
      continue;
    }

    flushRun();
    run = eligibleSpan ? [patch] : [];
    runSpanIndex = eligibleSpan ? spanIndex : -1;
    if (!eligibleSpan) {
      result.push(patch);
    }
  }
  flushRun();

  return result;
}

// Merges a run of >= 2 adjacent token patches into one patch spanning
// `[firstFrom, lastTo)`. `expected` is the original-text slice (the patches'
// expecteds interleaved with the unchanged gap text); `insert` is the patches'
// inserts interleaved with the same gap text.
function mergeTokenPatchRun(group, run) {
  const first = run[0];
  const last = run[run.length - 1];
  let expected = first.expected;
  let insert = first.insert;

  for (let index = 1; index < run.length; index += 1) {
    const prev = run[index - 1];
    const current = run[index];
    const gap = group.oldText.slice(
      prev.to - group.oldStart,
      current.from - group.oldStart
    );
    expected += gap + current.expected;
    insert += gap + current.insert;
  }

  return {
    from: first.from,
    to: last.to,
    expected,
    insert
  };
}

module.exports = {
  computeTextPatches,
  computeSingleTextPatch,
  computeLineAnchoredChangeGroups,
  computeTokenAnchoredPatches,
  computeGroupMetrics,
  classifyChangedGroup,
  splitParagraphs,
  splitSentences,
  hasOriginalMarkerLine,
  hasLaterRevisedMarkerLine,
  hasAnyAnnotatedMarker,
  countNonEmptyLines,
  countSentenceTerminators,
  singleGroupPatch,
  computeParagraphPatches,
  computeSentencePatches,
  coalesceTokenPatches
};
