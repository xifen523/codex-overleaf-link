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

const { handleRequest } = require('../native-host/src/taskRunner');

test('mirror.sync method syncs project files without running Codex', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-bg-sync-'));
  try {
    const response = await handleRequest({
      id: 'sync-1',
      method: 'mirror.sync',
      params: {
        projectId: 'bg-sync-test',
        project: {
          capabilities: { fullProjectSnapshot: true },
          files: [
            { path: 'main.tex', content: 'synced content' },
            { path: 'ch1.tex', content: 'chapter 1' }
          ]
        }
      }
    }, { CODEX_OVERLEAF_MIRROR_ROOT: rootDir });

    assert.equal(response.ok, true);
    assert.equal(response.result.fileCount, 2);
    assert.equal(typeof response.result.writtenCount, 'number');

    const mirror = getProjectMirror('bg-sync-test', { rootDir });
    assert.equal(
      fs.readFileSync(path.join(mirror.workspacePath, 'main.tex'), 'utf8'),
      'synced content'
    );
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('mirror.sync rejects snapshots without explicit full-project evidence', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-bg-sync-'));
  try {
    const response = await handleRequest({
      id: 'sync-not-full',
      method: 'mirror.sync',
      params: {
        projectId: 'bg-sync-test',
        project: {
          files: [{ path: 'main.tex', content: 'partial content' }]
        }
      }
    }, { CODEX_OVERLEAF_MIRROR_ROOT: rootDir });

    assert.equal(response.ok, false);
    assert.equal(response.error.code, 'mirror_sync_requires_full_project');
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('mirror.sync skips unchanged files on second call', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-bg-sync-'));
  try {
    const files = [
      { path: 'main.tex', content: 'content A' },
      { path: 'refs.bib', content: 'bib A' }
    ];

    await handleRequest({
      id: 'sync-first',
      method: 'mirror.sync',
      params: { projectId: 'bg-skip-test', project: { capabilities: { fullProjectSnapshot: true }, files } }
    }, { CODEX_OVERLEAF_MIRROR_ROOT: rootDir });

    const response = await handleRequest({
      id: 'sync-second',
      method: 'mirror.sync',
      params: { projectId: 'bg-skip-test', project: { capabilities: { fullProjectSnapshot: true }, files } }
    }, { CODEX_OVERLEAF_MIRROR_ROOT: rootDir });

    assert.equal(response.ok, true);
    assert.equal(response.result.writtenCount, 0);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
