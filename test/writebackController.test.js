const assert = require('node:assert/strict');
const test = require('node:test');

const WritebackController = require('../extension/src/content/writebackController');

test('buildSyncApplyOperations prefers local text patches for existing files', () => {
  const operations = WritebackController.buildSyncApplyOperations([
    {
      type: 'write',
      path: 'main.tex',
      previousContent: 'alpha beta',
      content: 'alpha gamma'
    }
  ], {
    files: [
      { path: 'main.tex', content: 'alpha beta' }
    ]
  });

  assert.deepEqual(operations, [
    {
      type: 'edit',
      path: 'main.tex',
      patches: [
        {
          from: 6,
          to: 9,
          expected: 'bet',
          insert: 'gamm'
        }
      ],
      reason: '同步本地 Codex workspace 中的局部文件改动（1 处）。'
    }
  ]);
});

test('mergeVerifiedAppliedFiles preserves Overleaf snapshot but overlays verified writeback content', () => {
  const merged = WritebackController.mergeVerifiedAppliedFiles({
    files: [
      { path: 'main.tex', kind: 'text', content: 'stale' },
      { path: 'refs.bib', kind: 'text', content: '@article{x}' }
    ]
  }, {
    files: [
      { path: 'main.tex', kind: 'text', content: 'before' }
    ]
  }, {
    applied: [
      {
        operation: { type: 'edit', path: 'main.tex' },
        result: { verifiedContent: 'after' }
      }
    ]
  });

  assert.equal(merged.files.find(file => file.path === 'main.tex').content, 'after');
  assert.equal(merged.files.find(file => file.path === 'main.tex').source, 'verified-writeback');
  assert.equal(merged.files.find(file => file.path === 'refs.bib').content, '@article{x}');
});

test('getAppliedSyncChanges returns only changes that were actually written', () => {
  const changes = WritebackController.getAppliedSyncChanges([
    { path: 'main.tex' },
    { path: 'refs.bib' }
  ], {
    applied: [
      { operation: { type: 'edit', path: 'main.tex' } }
    ]
  });

  assert.deepEqual(changes, [{ path: 'main.tex' }]);
});
