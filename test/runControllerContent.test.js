const assert = require('node:assert/strict');
const test = require('node:test');

const RunController = require('../extension/src/content/runController');

test('run controller builds codex.run params without embedding project when mirror is reused', () => {
  const params = RunController.buildCodexRunParams({
    currentProjectId: 'project-123',
    state: {
      mode: 'auto',
      model: 'gpt-5.5',
      reasoningEffort: 'xhigh',
      session: { id: 'session-1' }
    },
    task: '检查语法',
    project: { files: [{ path: 'main.tex', content: 'hello' }] },
    useExistingMirror: true,
    fileOverlays: [{ path: 'main.tex', content: 'live' }],
    focusFiles: ['main.tex'],
    codexThreadId: 'thread-1',
    compileLogContext: {
      available: true,
      log: 'compile log',
      errors: ['error'],
      warnings: ['warning'],
      fresh: true,
      compiledAt: 1777651200000
    }
  });

  assert.equal(params.projectId, 'project-123');
  assert.equal(params.project, undefined);
  assert.equal(params.useExistingMirror, true);
  assert.deepEqual(params.fileOverlays, [{ path: 'main.tex', content: 'live' }]);
  assert.equal(params.expectedMirrorFreshness, 300000);
  assert.equal(params.threadId, 'thread-1');
  assert.equal(params.compileLog, 'compile log');
  assert.deepEqual(params.compileErrors, ['error']);
});

test('run controller allows focused partial snapshots when every focused file is present', () => {
  assert.equal(
    RunController.canUseFocusedPartialSnapshot({
      project: {
        capabilities: { fullProjectSnapshot: false },
        files: [{ path: 'paper.tex', content: '\\documentclass{article}\n'.repeat(8) }]
      },
      snapshotWarnings: { blocking: ['Full project snapshot was not captured.'] },
      focusFiles: ['paper.tex'],
      isUsableProjectFileContent: text => text.length > 80
    }),
    true
  );

  assert.equal(
    RunController.canUseFocusedPartialSnapshot({
      project: {
        capabilities: { fullProjectSnapshot: false },
        files: [{ path: 'paper.tex', content: '\\documentclass{article}\n'.repeat(8) }]
      },
      snapshotWarnings: { blocking: ['Full project snapshot was not captured.'] },
      focusFiles: ['paper.tex', 'ref.bib'],
      isUsableProjectFileContent: text => text.length > 80
    }),
    false
  );
});

test('focused partial snapshot matching normalizes @file labels and leading slashes', () => {
  assert.equal(
    RunController.canUseFocusedPartialSnapshot({
      project: {
        capabilities: { fullProjectSnapshot: false },
        files: [{ path: 'sections/paper.tex', content: '\\documentclass{article}\n'.repeat(8) }]
      },
      snapshotWarnings: { blocking: ['Full project snapshot was not captured.'] },
      focusFiles: ['@file:/sections/paper.tex'],
      isUsableProjectFileContent: text => text.length > 80
    }),
    true
  );
});

test('focused partial snapshot can continue when the full-project ZIP failed with extra snapshot warnings', () => {
  assert.equal(
    RunController.canUseFocusedPartialSnapshot({
      project: {
        capabilities: { fullProjectSnapshot: false },
        files: [{ path: 'paper.tex', content: '\\documentclass{article}\n' }]
      },
      snapshotWarnings: {
        blocking: [
          'Full project snapshot was not captured.',
          'Every captured file is suspiciously short; Overleaf editor content was not read correctly.'
        ]
      },
      focusFiles: ['paper.tex'],
      isUsableProjectFileContent: text => text.includes('\\documentclass')
    }),
    true
  );
});

test('focused partial runs restrict writeback to focused files', () => {
  const params = RunController.buildCodexRunParams({
    currentProjectId: 'project-123',
    state: {
      mode: 'auto',
      model: 'gpt-5.5',
      reasoningEffort: 'xhigh',
      session: { id: 'session-1' }
    },
    task: '检查语法',
    project: {
      capabilities: { fullProjectSnapshot: false },
      files: [{ path: 'paper.tex', content: 'live' }]
    },
    useExistingMirror: false,
    focusFiles: ['paper.tex'],
    restrictToFocusFiles: true
  });

  assert.equal(params.restrictToFocusFiles, true);
  assert.deepEqual(params.focusFiles, ['paper.tex']);
});

test('focused full-project runs still restrict writeback to focused files', () => {
  assert.equal(
    RunController.shouldRestrictWritebackToFocus({
      focusFiles: ['paper.tex'],
      project: { capabilities: { fullProjectSnapshot: true } }
    }),
    true
  );
  assert.equal(
    RunController.shouldRestrictWritebackToFocus({
      focusFiles: [],
      project: { capabilities: { fullProjectSnapshot: true } }
    }),
    false
  );
});

test('run controller truncates session history summaries while preserving changed files', () => {
  const result = RunController.buildSessionHistoryResult({
    assistantMessage: '结论：没有问题。',
    syncChanges: Array.from({ length: 10 }, (_, index) => ({ path: `file-${index}.tex` }))
  });

  assert.match(result, /结论：没有问题。/);
  assert.match(result, /涉及文件：file-0\.tex, file-1\.tex/);
  assert.match(result, /等/);
});

test('run controller localizes session history changed file labels in English', () => {
  const result = RunController.buildSessionHistoryResult({
    locale: 'en',
    assistantMessage: 'Conclusion: no issues.',
    syncChanges: Array.from({ length: 10 }, (_, index) => ({ path: `file-${index}.tex` }))
  });

  assert.match(result, /Files changed: file-0\.tex, file-1\.tex/);
  assert.match(result, /and more/);
  assert.doesNotMatch(result, /涉及文件| 等/);
});
