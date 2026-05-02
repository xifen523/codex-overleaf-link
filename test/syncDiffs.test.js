const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runCodexSession } = require('../native-host/src/codexSessionRunner');

test('attaches line diffs to sync changes in codex.run result', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-diff-'));
  try {
    const result = await runCodexSession({
      params: {
        projectId: 'diff-attach-test',
        task: 'fix title',
        mode: 'auto',
        project: { files: [{ path: 'main.tex', content: 'old title\nbody\nend\n' }] }
      },
      rootDir,
      emit: () => {},
      executeCodex: async ({ workspacePath }) => {
        fs.writeFileSync(path.join(workspacePath, 'main.tex'), 'new title\nbody\nend\n', 'utf8');
      }
    });

    assert.equal(result.syncChanges.length, 1);
    const change = result.syncChanges[0];
    assert.equal(change.path, 'main.tex');
    assert.equal(change.type, 'write');
    assert.ok(Array.isArray(change.diff), 'syncChange should have a diff array');
    assert.ok(Array.isArray(change.patches), 'syncChange should have text patches');
    assert.equal(change.diff.length, 1);
    assert.deepEqual(change.patches, [
      { from: 0, to: 3, expected: 'old', insert: 'new' }
    ]);
    assert.ok(change.diff[0].lines.some(l => l.type === 'remove' && l.text === 'old title'));
    assert.ok(change.diff[0].lines.some(l => l.type === 'add' && l.text === 'new title'));
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('does not attach diff for delete changes', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-diff-'));
  try {
    const result = await runCodexSession({
      params: {
        projectId: 'diff-delete-test',
        task: 'remove extra.tex',
        mode: 'auto',
        project: {
          files: [
            { path: 'main.tex', content: 'keep' },
            { path: 'extra.tex', content: 'remove me' }
          ]
        }
      },
      rootDir,
      emit: () => {},
      executeCodex: async ({ workspacePath }) => {
        fs.unlinkSync(path.join(workspacePath, 'extra.tex'));
      }
    });

    const deleteChange = result.syncChanges.find(c => c.type === 'delete');
    assert.ok(deleteChange);
    assert.equal(deleteChange.diff, undefined);
    assert.equal(deleteChange.patches, undefined);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
