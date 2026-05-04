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
      reasonKey: 'localWorkspacePatch',
      reasonParams: { count: 1 },
      reason: 'Synced 1 local Codex workspace edit.'
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

test('malformed applied entries do not count as written sync changes or paths', () => {
  const syncChanges = [
    { path: 'main.tex' },
    { path: 'refs.bib' }
  ];

  for (const applied of [
    { applied: 'x', skipped: [] },
    { applied: { length: 1 }, skipped: [] }
  ]) {
    assert.deepEqual(WritebackController.getAppliedSyncChanges(syncChanges, applied), []);
    assert.deepEqual(WritebackController.getAppliedOperationPaths(applied), []);
  }
});

test('malformed applied entries do not alter verified mirror merge', () => {
  const freshProject = {
    files: [
      { path: 'main.tex', kind: 'text', content: 'fresh' }
    ]
  };
  const originalProject = {
    files: [
      { path: 'main.tex', kind: 'text', content: 'before' }
    ]
  };

  for (const applied of [
    { applied: 'x', skipped: [] },
    { applied: { length: 1 }, skipped: [] }
  ]) {
    assert.deepEqual(
      WritebackController.mergeVerifiedAppliedFiles(freshProject, originalProject, applied),
      freshProject
    );
  }
});

test('unsupported local changes are reported with per-file user-readable reasons', () => {
  const summary = WritebackController.formatUnsupportedLocalChangeSummary([
    { path: 'main.pdf', reason: 'generated_artifact' },
    { path: 'diagram.png', reason: 'unsupported_non_text_file' },
    { path: 'unknown.bin', reason: 'unknown_reason' }
  ]);

  assert.match(summary, /Codex 在本地生成了这些文件，但插件没有同步回 Overleaf/);
  assert.match(summary, /- main\.pdf：LaTeX 构建产物，默认不写回。/);
  assert.match(summary, /- diagram\.png：非文本文件，暂不支持自动写回。/);
  assert.match(summary, /- unknown\.bin：当前类型暂不支持自动写回。/);
});

test('unsupported local changes are localized in English', () => {
  const summary = WritebackController.formatUnsupportedLocalChangeSummary([
    { path: 'main.pdf', reason: 'generated_artifact' },
    { path: 'diagram.png', reason: 'unsupported_non_text_file' },
    { path: 'unknown.bin', reason: 'unknown_reason' }
  ], 'en');

  assert.match(summary, /Codex generated these local files, but the extension did not sync them back to Overleaf/);
  assert.match(summary, /- main\.pdf: LaTeX build artifact; not written back by default\./);
  assert.match(summary, /- diagram\.png: Non-text file; automatic writeback is not supported yet\./);
  assert.match(summary, /- unknown\.bin: This file type is not supported for automatic writeback yet\./);
  assert.doesNotMatch(summary, /[\u4e00-\u9fff]/);
});
