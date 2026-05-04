const assert = require('node:assert/strict');
const test = require('node:test');

const {
  HIGH_RISK_TYPES,
  buildChangeSummaryLine,
  buildOperationSummary,
  hasSkippedApplyOperations,
  splitDeletePlan
} = require('../extension/src/shared/summary');

test('builds a task-level operation summary without exposing diff content', () => {
  const summary = buildOperationSummary([
    { type: 'edit', path: 'main.tex', hunks: [{ before: 'alpha', after: 'beta' }] },
    { type: 'edit', path: 'sections/method.tex' },
    { type: 'create', path: 'sections/appendix.tex' },
    { type: 'rename', path: 'old.tex', to: 'new.tex' },
    { type: 'move', path: 'figures/a.pdf', to: 'assets/a.pdf' },
    { type: 'delete', path: 'draft-notes.tex', reason: 'merged into main.tex' }
  ]);

  assert.deepEqual(summary.counts, {
    edit: 2,
    create: 1,
    rename: 1,
    move: 1,
    delete: 1,
    binaryOverwrite: 0,
    trackedChangeDecision: 0
  });
  assert.deepEqual(summary.affectedFiles, [
    'assets/a.pdf',
    'draft-notes.tex',
    'figures/a.pdf',
    'main.tex',
    'new.tex',
    'old.tex',
    'sections/appendix.tex',
    'sections/method.tex'
  ]);
  assert.equal(JSON.stringify(summary).includes('alpha'), false);
  assert.equal(JSON.stringify(summary).includes('beta'), false);
});

test('separates Auto Mode delete plan from immediately executable operations', () => {
  const split = splitDeletePlan([
    { type: 'edit', path: 'main.tex' },
    { type: 'delete', path: 'unused.tex', reason: 'not referenced' },
    { type: 'overwrite-binary', path: 'figure.pdf' }
  ]);

  assert.deepEqual(split.immediate, [{ type: 'edit', path: 'main.tex' }]);
  assert.deepEqual(split.needsConfirmation, [
    { type: 'delete', path: 'unused.tex', reason: 'not referenced' },
    { type: 'overwrite-binary', path: 'figure.pdf' }
  ]);
});

test('tracks high-risk operation types', () => {
  assert.deepEqual(HIGH_RISK_TYPES, ['delete', 'overwrite-binary', 'tracked-change-decision']);
});

test('builds a one-line summary from applied operations', () => {
  const line = buildChangeSummaryLine({
    applyResults: [{
      applied: [
        { operation: { type: 'edit', path: 'main.tex' } },
        { operation: { type: 'create', path: 'sections/appendix.tex' } }
      ],
      skipped: [
        { operation: { type: 'delete', path: 'draft.tex' }, result: { reason: 'delete requires approval' } }
      ]
    }]
  });

  assert.equal(
    line,
    'Summary: edited 1 file and created 1 file (main.tex, sections/appendix.tex); 1 operation skipped.'
  );
});

test('builds a one-line summary for analysis-only runs', () => {
  const line = buildChangeSummaryLine({
    notes: 'No obvious citation issues found in the supplied files.',
    operations: []
  });

  assert.equal(
    line,
    'Summary: no project files changed; No obvious citation issues found in the supplied files.'
  );
});

test('builds a one-line summary for rejected task changes', () => {
  const line = buildChangeSummaryLine({
    status: 'rejected',
    summary: buildOperationSummary([{ type: 'edit', path: 'main.tex' }])
  });

  assert.equal(line, 'Summary: proposed changes were rejected; no project files changed.');
});

test('does not report skipped operations as applied changes', () => {
  const line = buildChangeSummaryLine({
    operations: [{ type: 'edit', path: 'main.tex' }],
    applyResults: [{
      applied: [],
      skipped: [
        { operation: { type: 'edit', path: 'main.tex' }, result: { reason: 'find text not found' } }
      ]
    }]
  });

  assert.equal(line, 'Summary: no project files changed; 1 operation skipped.');
});

test('detects skipped apply operations for run-level failure status', () => {
  assert.equal(hasSkippedApplyOperations([
    {
      applied: [{ operation: { type: 'edit', path: 'main.tex' } }],
      skipped: []
    },
    {
      applied: [],
      skipped: [{ operation: { type: 'edit', path: 'refs.bib' } }]
    }
  ]), true);

  assert.equal(hasSkippedApplyOperations([
    {
      applied: [{ operation: { type: 'edit', path: 'main.tex' } }],
      skipped: []
    }
  ]), false);
});

test('ignores malformed apply result entry containers', () => {
  const line = buildChangeSummaryLine({
    applyResults: [
      { applied: 'x', skipped: { length: 1 } },
      { applied: { length: 1 }, skipped: 'x' }
    ]
  });

  assert.equal(line, 'Summary: no project files changed.');
  assert.equal(hasSkippedApplyOperations([
    { skipped: { length: 1 } },
    { skipped: 'x' }
  ]), false);
});

test('preserves Chinese sentence punctuation in notes summaries', () => {
  const line = buildChangeSummaryLine({
    notes: 'summary 功能已检查，未修改任何内容。',
    operations: []
  });

  assert.equal(line, 'Summary: no project files changed; summary 功能已检查，未修改任何内容。');
});
