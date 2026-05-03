const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildUndoCheckpoint,
  buildExpectedFilesAfterOperations,
  buildUndoOperations
} = require('../extension/src/shared/undoOperations');

test('builds undo operations from the pre-run project snapshot', () => {
  const project = {
    files: [
      { path: 'main.tex', content: 'alpha' },
      { path: 'old.tex', content: 'old body' },
      { path: 'unused.tex', content: 'unused body' }
    ]
  };

  const undo = buildUndoOperations(project, [
    { type: 'edit', path: 'main.tex', find: 'alpha', replace: 'beta' },
    { type: 'create', path: 'new.tex', content: 'new body' },
    { type: 'rename', path: 'old.tex', to: 'renamed.tex' },
    { type: 'delete', path: 'unused.tex', reason: 'not referenced' }
  ]);

  assert.deepEqual(undo, [
    { type: 'create', path: 'unused.tex', to: null, find: null, replace: null, replaceAll: null, content: 'unused body', reason: 'Undo delete' },
    { type: 'rename', path: 'renamed.tex', to: 'old.tex', find: null, replace: null, replaceAll: null, content: null, reason: 'Undo rename' },
    { type: 'delete', path: 'new.tex', to: null, find: null, replace: null, replaceAll: null, content: null, reason: 'Undo create' },
    { type: 'edit', path: 'main.tex', to: null, find: null, replace: null, replaceAll: 'alpha', content: null, reason: 'Undo edit' }
  ]);
});

test('coalesces multiple edits to the same file into one full-file restore', () => {
  const undo = buildUndoOperations({
    files: [{ path: 'main.tex', content: 'original' }]
  }, [
    { type: 'edit', path: 'main.tex', find: 'a', replace: 'b' },
    { type: 'edit', path: 'main.tex', find: 'c', replace: 'd' }
  ]);

  assert.deepEqual(undo, [
    { type: 'edit', path: 'main.tex', to: null, find: null, replace: null, replaceAll: 'original', content: null, reason: 'Undo edit' }
  ]);
});

test('builds local inverse patches for patch-based edits instead of full-file undo replacement', () => {
  const undo = buildUndoOperations({
    files: [{ path: 'main.tex', content: 'alpha beta gamma' }]
  }, [
    {
      type: 'edit',
      path: 'main.tex',
      patches: [
        { from: 6, to: 10, expected: 'beta', insert: 'delta' }
      ]
    }
  ]);

  assert.deepEqual(undo, [
    {
      type: 'edit',
      path: 'main.tex',
      to: null,
      find: null,
      replace: null,
      replaceAll: null,
      patches: [
        { from: 6, to: 11, expected: 'delta', insert: 'beta' }
      ],
      content: null,
      reason: 'Undo edit'
    }
  ]);
});

test('builds inverse patch ranges against the post-edit content after earlier patch shifts', () => {
  const undo = buildUndoOperations({
    files: [{ path: 'main.tex', content: 'one two three four' }]
  }, [
    {
      type: 'edit',
      path: 'main.tex',
      patches: [
        { from: 4, to: 7, expected: 'two', insert: 'twenty' },
        { from: 14, to: 18, expected: 'four', insert: '4' }
      ]
    }
  ]);

  assert.deepEqual(undo[0].patches, [
    { from: 4, to: 10, expected: 'twenty', insert: 'two' },
    { from: 17, to: 18, expected: '4', insert: 'four' }
  ]);
});

test('does not add fragile inverse patches after a full-file undo restore already covers the file', () => {
  const undo = buildUndoOperations({
    files: [{ path: 'main.tex', content: 'original alpha' }]
  }, [
    { type: 'edit', path: 'main.tex', replaceAll: 'rewritten beta' },
    {
      type: 'edit',
      path: 'main.tex',
      patches: [
        { from: 10, to: 14, expected: 'beta', insert: 'gamma' }
      ]
    }
  ]);

  assert.deepEqual(undo, [
    { type: 'edit', path: 'main.tex', to: null, find: null, replace: null, replaceAll: 'original alpha', content: null, reason: 'Undo edit' }
  ]);
});

test('skips undo operations that need unavailable original content', () => {
  const undo = buildUndoOperations({
    files: []
  }, [
    { type: 'edit', path: 'missing.tex', find: 'a', replace: 'b' },
    { type: 'delete', path: 'missing.tex' }
  ]);

  assert.deepEqual(undo, []);
});

test('builds an undo checkpoint guarded by the expected post-apply project state', () => {
  const checkpoint = buildUndoCheckpoint({
    files: [
      { path: 'main.tex', content: 'alpha old' },
      { path: 'old.tex', content: 'old body' },
      { path: 'deleted.tex', content: 'delete me' },
      { path: 'unrelated.tex', content: 'large unrelated file' }
    ]
  }, [
    { type: 'edit', path: 'main.tex', find: 'old', replace: 'new' },
    { type: 'create', path: 'created.tex', content: 'created body' },
    { type: 'rename', path: 'old.tex', to: 'renamed.tex' },
    { type: 'delete', path: 'deleted.tex', reason: 'cleanup' }
  ]);

  assert.deepEqual(checkpoint.undoBaseFiles, [
    { path: 'main.tex', content: 'alpha new' },
    { path: 'created.tex', content: 'created body' },
    { path: 'renamed.tex', content: 'old body' }
  ]);
  assert.deepEqual(checkpoint.undoOperations, [
    { type: 'create', path: 'deleted.tex', to: null, find: null, replace: null, replaceAll: null, content: 'delete me', reason: 'Undo delete' },
    { type: 'rename', path: 'renamed.tex', to: 'old.tex', find: null, replace: null, replaceAll: null, content: null, reason: 'Undo rename' },
    { type: 'delete', path: 'created.tex', to: null, find: null, replace: null, replaceAll: null, content: null, reason: 'Undo create' },
    { type: 'edit', path: 'main.tex', to: null, find: null, replace: null, replaceAll: 'alpha old', content: null, reason: 'Undo edit' }
  ]);
});

test('builds post-apply undo base files from local edit patches', () => {
  const expected = buildExpectedFilesAfterOperations({
    files: [
      { path: 'main.tex', content: 'alpha beta gamma' }
    ]
  }, [
    {
      type: 'edit',
      path: 'main.tex',
      patches: [
        { from: 6, to: 10, expected: 'beta', insert: 'delta' }
      ]
    }
  ]);

  assert.deepEqual(Array.from(expected.entries()), [
    ['main.tex', 'alpha delta gamma']
  ]);
});
