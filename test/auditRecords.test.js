const assert = require('node:assert/strict');
const test = require('node:test');

const audit = require('../extension/src/shared/auditRecords');

test('buildAuditDraftRecord stores summaries without prompt bodies', () => {
  const record = audit.buildAuditDraftRecord({
    id: 'aud_1',
    projectId: 'proj',
    sessionId: 'ses',
    turnId: 'turn',
    task: 'Rewrite the full introduction with private context',
    prompt: 'FULL PROMPT secret body that must not be stored',
    focusFiles: ['main.tex'],
    selectedSkillIds: ['style'],
    sensitiveFindings: [{ detectorId: 'secret-assignment', source: 'task', preview: 'secret = [REDACTED]' }],
    createdAt: '2026-05-06T00:00:00.000Z'
  });

  assert.equal(record.id, 'aud_1');
  assert.equal(record.projectId, 'proj');
  assert.equal(record.resultStatus, 'draft');
  assert.equal(record.prompt, undefined);
  assert.equal(record.task, undefined);
  assert.match(record.promptSummary, /Rewrite the full introduction/);
  assert.deepEqual(record.focusFiles, ['main.tex']);
  assert.deepEqual(record.selectedSkillIds, ['style']);
});

test('buildAuditFinalRecord stores file lists and diff counts only', () => {
  const final = audit.buildAuditFinalRecord({
    draft: audit.buildAuditDraftRecord({ id: 'aud_2', projectId: 'proj' }),
    completedAt: '2026-05-06T00:01:00.000Z',
    changedFiles: [{ path: 'main.tex', content: 'full body' }],
    appliedFiles: ['main.tex'],
    skippedFiles: [{ path: 'figures/raw.bin', reason: 'unsupported' }],
    blockedFiles: [{ path: 'locked.tex', reason: 'readonly', content: 'blocked body' }],
    diffSummary: { filesChanged: 2, additions: 5, deletions: 1 },
    resultStatus: 'blocked'
  });

  assert.equal(final.resultStatus, 'blocked');
  assert.deepEqual(final.changedFiles, [{ path: 'main.tex' }]);
  assert.deepEqual(final.appliedFiles, [{ path: 'main.tex' }]);
  assert.deepEqual(final.blockedFiles, [{ path: 'locked.tex', reason: 'readonly' }]);
  assert.deepEqual(final.diffSummary, { filesChanged: 2, additions: 5, deletions: 1 });
  assert.equal(JSON.stringify(final).includes('full body'), false);
});

test('buildDiagnosticBundle redacts content-bearing metadata', () => {
  const bundle = audit.buildDiagnosticBundle({
    compatibility: { status: 'ok', native: { version: '0.8.0', environment: { codex: { ok: true } } } },
    mirror: { status: 'ready', files: [{ path: 'main.tex', content: 'body' }] },
    auditLogs: [{ id: 'aud', projectId: 'proj', promptSummary: 'short', fullDiff: 'diff body' }],
    run: { id: 'run', events: [{ title: 'Applied files', text: 'full event text', errorCode: 'none' }] },
    governance: { readonlyPatterns: ['locked/**'], writablePatterns: ['main.tex'], sensitiveCheckEnabled: true },
    platform: { os: 'darwin', arch: 'arm64', content: 'secret platform content' },
    nativeEnvironment: { codex: { ok: true, path: '/usr/bin/codex' }, compileLog: 'secret compile log' },
    projectId: 'project-secret-id'
  });

  const serialized = JSON.stringify(bundle);
  assert.equal(serialized.includes('body'), false);
  assert.equal(serialized.includes('project-secret-id'), false);
  assert.equal(bundle.projectIdHash.length > 0, true);
  assert.deepEqual(bundle.platform, { os: 'darwin', arch: 'arm64' });
  assert.deepEqual(bundle.nativeEnvironment, { codex: { ok: true, path: '/usr/bin/codex' } });
  assert.deepEqual(bundle.governance, {
    readonlyPatternCount: 1,
    writablePatternCount: 1,
    sensitiveCheckEnabled: true,
    sensitiveConfirmAllowed: false
  });
});
