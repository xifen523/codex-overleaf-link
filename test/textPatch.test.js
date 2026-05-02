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
