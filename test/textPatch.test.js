const assert = require('node:assert/strict');
const test = require('node:test');

const {
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
} = require('../native-host/src/textPatch');

test('computes a small insertion patch instead of a full-file replacement', () => {
  const patches = computeTextPatches('hello world\n', 'hello brave world\n');

  assert.deepEqual(patches, [
    {
      from: 6,
      to: 6,
      expected: '',
      insert: 'brave '
    }
  ]);
});

test('computes a local replacement patch with expected old text', () => {
  const patches = computeTextPatches('old title\nbody\n', 'new title\nbody\n');

  assert.deepEqual(patches, [
    {
      from: 0,
      to: 3,
      expected: 'old',
      insert: 'new'
    }
  ]);
});

test('returns no patches for identical content', () => {
  assert.deepEqual(computeTextPatches('same\n', 'same\n'), []);
});

test('keeps distant line edits as separate local patches', () => {
  const oldText = [
    'title: old\n',
    'unchanged line 1\n',
    'unchanged line 2\n',
    'ending: old\n'
  ].join('');
  const newText = [
    'title: new\n',
    'unchanged line 1\n',
    'unchanged line 2\n',
    'ending: new\n'
  ].join('');

  assert.deepEqual(computeTextPatches(oldText, newText), [
    { from: 7, to: 10, expected: 'old', insert: 'new' },
    { from: 53, to: 56, expected: 'old', insert: 'new' }
  ]);
});

test('keeps distant edits in long LaTeX files as separate patches', () => {
  const oldLines = Array.from({ length: 1205 }, (_, index) => `line ${index}\n`);
  const newLines = oldLines.slice();
  newLines[12] = 'line 12 with local proof fix\n';
  newLines[1110] = 'line 1110 with local reference fix\n';
  const oldText = oldLines.join('');
  const newText = newLines.join('');

  const patches = computeTextPatches(oldText, newText);

  assert.equal(patches.length, 2);
  assert.equal(applyPatches(oldText, patches), newText);
  assert.ok(patches.every(patch => patch.to - patch.from < 80));
});

test('splits a rewritten wrapped paragraph into token-local patches', () => {
  const oldText = [
    'As generalized models of restless multi-armed bandits, weakly\n',
    'coupled networked systems have garnered attention due to\n',
    'applications such as fairness-aware multiple access and\n',
    'sustainable distributed load balancing in data centers.\n',
    'In these systems, agents are networked in the sense that their\n',
    'actions are constrained by global constraints, while they are\n',
    'weakly coupled since individual rewards and costs depend solely\n',
    "on each agent's own states and actions.\n",
    'We have proven that our algorithms achieve sublinear regrets and\n',
    'constraint violations, regardless of the existence of a presumed\n',
    'strictly feasible policy.\n'
  ].join('');
  const newText = [
    'As a generalization of restless multi-armed bandits, weakly\n',
    'coupled networked systems have garnered attention due to\n',
    'applications such as fairness-aware multiple access and\n',
    'sustainable distributed load balancing in data centers.\n',
    'In these systems, agents are coupled through global\n',
    'constraints, while they remain weakly coupled because\n',
    "individual rewards and costs depend solely on each agent's\n",
    'own state and action.\n',
    'We prove that our algorithms achieve sublinear regrets and\n',
    'constraint violations, regardless of whether a strictly\n',
    'feasible policy exists.\n'
  ].join('');

  const patches = computeTextPatches(oldText, newText);

  assert.equal(applyPatches(oldText, patches), newText);
  assert.ok(patches.length > 3, `expected token-local patches, got ${patches.length}`);
  assert.ok(
    patches.every(patch => Math.max(patch.to - patch.from, patch.insert.length) < 160),
    JSON.stringify(patches, null, 2)
  );
});

test('computeLineAnchoredChangeGroups returns no groups for identical content', () => {
  assert.deepEqual(computeLineAnchoredChangeGroups('same\n', 'same\n'), []);
});

test('computeLineAnchoredChangeGroups returns one group for a single one-line change', () => {
  const groups = computeLineAnchoredChangeGroups('old title\nbody\n', 'new title\nbody\n');

  assert.deepEqual(groups, [
    {
      oldStart: 0,
      oldText: 'old title\n',
      newText: 'new title\n'
    }
  ]);
});

test('computeLineAnchoredChangeGroups returns separate groups for far-apart edits', () => {
  const oldLines = Array.from({ length: 20 }, (_, index) => `line ${index}\n`);
  const newLines = oldLines.slice();
  newLines[0] = 'line 0 changed\n';
  newLines[19] = 'line 19 changed\n';
  const oldText = oldLines.join('');
  const newText = newLines.join('');

  const groups = computeLineAnchoredChangeGroups(oldText, newText);

  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0], {
    oldStart: 0,
    oldText: 'line 0\n',
    newText: 'line 0 changed\n'
  });
  const lastOldStart = oldText.length - 'line 19\n'.length;
  assert.deepEqual(groups[1], {
    oldStart: lastOldStart,
    oldText: 'line 19\n',
    newText: 'line 19 changed\n'
  });
});

test('computeLineAnchoredChangeGroups returns no groups when line-level limits are exceeded', () => {
  const oldLines = Array.from({ length: 6000 }, (_, index) => `line ${index}\n`);
  const newLines = oldLines.slice();
  newLines[10] = 'line 10 changed\n';
  const oldText = oldLines.join('');
  const newText = newLines.join('');

  assert.deepEqual(computeLineAnchoredChangeGroups(oldText, newText), []);
});

test('countNonEmptyLines counts only lines with non-empty trimmed content', () => {
  assert.equal(countNonEmptyLines(''), 0);
  assert.equal(countNonEmptyLines('\n\n'), 0);
  assert.equal(countNonEmptyLines('   \n\t\n'), 0);
  assert.equal(countNonEmptyLines('one line'), 1);
  assert.equal(countNonEmptyLines('first\nsecond\nthird\n'), 3);
  assert.equal(countNonEmptyLines('first\n\n   \nsecond\n'), 2);
});

test('countSentenceTerminators counts ASCII and CJK sentence terminators', () => {
  assert.equal(countSentenceTerminators(''), 0);
  assert.equal(countSentenceTerminators('No terminators here'), 0);
  assert.equal(countSentenceTerminators('One sentence.'), 1);
  assert.equal(countSentenceTerminators('First. Second! Third?'), 3);
  assert.equal(countSentenceTerminators('CJK terminators。And？And！'), 3);
});

test('countSentenceTerminators does not count a dot inside a decimal number', () => {
  assert.equal(countSentenceTerminators('The value is 1.23 here'), 0);
  assert.equal(countSentenceTerminators('Pi is 3.14159 roughly.'), 1);
});

test('hasOriginalMarkerLine detects an [original] marker line', () => {
  assert.equal(hasOriginalMarkerLine('% [original]'), true);
  assert.equal(hasOriginalMarkerLine('  %  [original]  '), true);
  assert.equal(hasOriginalMarkerLine('intro\n% [original]\nbody'), true);
  assert.equal(hasOriginalMarkerLine('% [revised]'), false);
  assert.equal(hasOriginalMarkerLine('text with [original] inline'), false);
  assert.equal(hasOriginalMarkerLine('% [original] trailing words'), false);
});

test('hasLaterRevisedMarkerLine requires a revised marker after the original marker', () => {
  assert.equal(
    hasLaterRevisedMarkerLine('% [original]\nold\n\n% [revised]\nnew'),
    true
  );
  assert.equal(
    hasLaterRevisedMarkerLine('% [revised]\nnew\n\n% [original]\nold'),
    false
  );
  assert.equal(hasLaterRevisedMarkerLine('% [revised]\nnew'), false);
  assert.equal(hasLaterRevisedMarkerLine('% [original]\nold'), false);
});

test('hasAnyAnnotatedMarker detects either marker line', () => {
  assert.equal(hasAnyAnnotatedMarker('% [original]\nold'), true);
  assert.equal(hasAnyAnnotatedMarker('intro\n% [revised]\nnew'), true);
  assert.equal(hasAnyAnnotatedMarker('plain paragraph text'), false);
});

test('splitParagraphs returns ordered segments that reconstruct the input exactly', () => {
  const text = 'first paragraph\n\nsecond paragraph\n\n\nthird paragraph';
  const segments = splitParagraphs(text);

  assert.ok(segments.length >= 1);
  assert.equal(segments.map(segment => segment.text).join(''), text);
  for (const segment of segments) {
    assert.equal(text.slice(segment.start, segment.start + segment.text.length), segment.text);
  }
});

test('splitParagraphs keeps a single segment when there is no blank line', () => {
  const text = 'one paragraph\nwith two lines';
  const segments = splitParagraphs(text);

  assert.equal(segments.map(segment => segment.text).join(''), text);
  assert.equal(segments[0].start, 0);
});

test('splitParagraphs reconstructs input with leading and trailing blank lines', () => {
  const text = '\n\nmiddle paragraph\n\n';
  const segments = splitParagraphs(text);

  assert.equal(segments.map(segment => segment.text).join(''), text);
  for (const segment of segments) {
    assert.equal(text.slice(segment.start, segment.start + segment.text.length), segment.text);
  }
});

function assertSpansPartition(text, spans) {
  assert.ok(Array.isArray(spans));
  assert.ok(spans.length >= 1);
  assert.equal(spans.map(span => span.text).join(''), text);
  let cursor = 0;
  for (const span of spans) {
    assert.equal(span.start, cursor);
    assert.equal(span.end, span.start + span.text.length);
    assert.equal(span.text, text.slice(span.start, span.end));
    cursor = span.end;
  }
  assert.equal(cursor, text.length);
}

test('splitSentences splits two plain sentences ending in a period and a bang', () => {
  const text = 'First sentence. Second sentence!';
  const spans = splitSentences(text);

  assertSpansPartition(text, spans);
  assert.equal(spans.length, 2);
  assert.equal(spans[0].text, 'First sentence. ');
  assert.equal(spans[1].text, 'Second sentence!');
  assert.equal(spans[0].start, 0);
  assert.equal(spans[0].end, 16);
  assert.equal(spans[1].start, 16);
  assert.equal(spans[1].end, 32);
});

test('splitSentences splits CJK sentences ending in fullwidth terminators', () => {
  const text = '第一句话。第二个句子？';
  const spans = splitSentences(text);

  assertSpansPartition(text, spans);
  assert.equal(spans.length, 2);
  assert.equal(spans[0].text, '第一句话。');
  assert.equal(spans[1].text, '第二个句子？');
});

test('splitSentences does not split inside a decimal number', () => {
  const text = 'The value is 1.23 here.';
  const spans = splitSentences(text);

  assertSpansPartition(text, spans);
  assert.equal(spans.length, 1);
  assert.equal(spans[0].text, text);
});

test('splitSentences does not split inside a URL', () => {
  const text = 'See https://a.b/c for details.';
  const spans = splitSentences(text);

  assertSpansPartition(text, spans);
  assert.equal(spans.length, 1);
  assert.equal(spans[0].text, text);
});

test('splitSentences treats a terminator before a LaTeX command as a boundary', () => {
  const text = 'done.\\section{Next}';
  const spans = splitSentences(text);

  assertSpansPartition(text, spans);
  assert.equal(spans.length, 2);
  assert.equal(spans[0].text, 'done.');
  assert.equal(spans[1].text, '\\section{Next}');
});

test('splitSentences returns one span when there is no confident boundary', () => {
  const text = 'a rewrite fragment with no terminator at all';
  const spans = splitSentences(text);

  assertSpansPartition(text, spans);
  assert.equal(spans.length, 1);
  assert.equal(spans[0].text, text);
});

test('computeGroupMetrics reports counts and char spans for a group with token patches', () => {
  const group = {
    oldStart: 5,
    oldText: 'First sentence. Second sentence.',
    newText: 'First sentence rewritten. Second sentence here. Third one.'
  };
  const tokenPatches = [
    { from: 5, to: 10, expected: 'First', insert: 'Initial' },
    { from: 20, to: 20, expected: '', insert: ' added words' }
  ];

  const metrics = computeGroupMetrics(group, tokenPatches);

  assert.deepEqual(metrics, {
    oldNonEmptyLineCount: 1,
    newNonEmptyLineCount: 1,
    maxNonEmptyLineCount: 1,
    changedSpanChars: Math.max(group.oldText.length, group.newText.length),
    tokenPatchCount: 2,
    totalTokenChangedChars: Math.max(5, 'Initial'.length) + Math.max(0, ' added words'.length),
    oldSentenceTerminatorCount: 2,
    newSentenceTerminatorCount: 3
  });
});

test('computeGroupMetrics reports null token fields when tokenPatches is null', () => {
  const group = {
    oldStart: 0,
    oldText: 'line one\nline two\nline three',
    newText: 'line one changed\nline two\nline three\nline four'
  };

  const metrics = computeGroupMetrics(group, null);

  assert.equal(metrics.tokenPatchCount, null);
  assert.equal(metrics.totalTokenChangedChars, null);
  assert.equal(metrics.oldNonEmptyLineCount, 3);
  assert.equal(metrics.newNonEmptyLineCount, 4);
  assert.equal(metrics.maxNonEmptyLineCount, 4);
  assert.equal(metrics.changedSpanChars, Math.max(group.oldText.length, group.newText.length));
});

function applyPatches(text, patches) {
  return patches.slice().sort((left, right) => right.from - left.from).reduce((next, patch) => {
    assert.equal(next.slice(patch.from, patch.to), patch.expected);
    return next.slice(0, patch.from) + patch.insert + next.slice(patch.to);
  }, text);
}
