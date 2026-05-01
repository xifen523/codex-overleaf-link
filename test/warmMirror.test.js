const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { syncOverleafToMirror, getProjectMirror } = require('../native-host/src/mirrorWorkspace');

test('skips writing files whose content matches the existing baseline', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-warm-'));
  try {
    await syncOverleafToMirror({
      projectId: 'warm-test',
      rootDir,
      project: {
        files: [
          { path: 'main.tex', content: 'hello world' },
          { path: 'refs.bib', content: '@article{a}' }
        ]
      }
    });

    const mirror = getProjectMirror('warm-test', { rootDir });
    const mainPath = path.join(mirror.workspacePath, 'main.tex');
    const firstMtime = fs.statSync(mainPath).mtimeMs;

    await new Promise(r => setTimeout(r, 50));

    const result = await syncOverleafToMirror({
      projectId: 'warm-test',
      rootDir,
      project: {
        files: [
          { path: 'main.tex', content: 'hello world' },
          { path: 'refs.bib', content: '@article{b, updated}' }
        ]
      }
    });

    const secondMtime = fs.statSync(mainPath).mtimeMs;
    assert.equal(secondMtime, firstMtime, 'unchanged file should not be rewritten');
    assert.equal(
      fs.readFileSync(path.join(mirror.workspacePath, 'refs.bib'), 'utf8'),
      '@article{b, updated}'
    );
    assert.equal(result.fileCount, 2);
    assert.equal(result.writtenCount, 1);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('returns writtenCount of all files on first sync (no baseline)', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-warm-'));
  try {
    const result = await syncOverleafToMirror({
      projectId: 'first-sync',
      rootDir,
      project: {
        files: [
          { path: 'main.tex', content: 'content' },
          { path: 'ch1.tex', content: 'chapter 1' }
        ]
      }
    });

    assert.equal(result.fileCount, 2);
    assert.equal(result.writtenCount, 2);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
