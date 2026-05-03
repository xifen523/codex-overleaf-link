const assert = require('node:assert/strict');
const test = require('node:test');

const { computeTextPatches } = require('../native-host/src/textPatch');

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

function applyPatches(text, patches) {
  return patches.slice().sort((left, right) => right.from - left.from).reduce((next, patch) => {
    assert.equal(next.slice(patch.from, patch.to), patch.expected);
    return next.slice(0, patch.from) + patch.insert + next.slice(patch.to);
  }, text);
}
