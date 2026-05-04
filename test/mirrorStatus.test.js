'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { syncOverleafToMirror, getProjectMirror, getMirrorStatus, applyFileOverlays } = require('../native-host/src/mirrorWorkspace');

let tempRoot;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-status-'));
});

test('syncOverleafToMirror writes lastFullSyncAt to baseline', async () => {
  const before = Date.now();
  await syncOverleafToMirror({
    projectId: 'test-proj',
    project: { files: [{ path: 'main.tex', content: '\\documentclass{article}' }] },
    rootDir: tempRoot
  });
  const mirror = getProjectMirror('test-proj', { rootDir: tempRoot });
  const baseline = JSON.parse(fs.readFileSync(mirror.baselinePath, 'utf8'));
  assert.ok(baseline.lastFullSyncAt);
  const syncTime = new Date(baseline.lastFullSyncAt).getTime();
  assert.ok(syncTime >= before);
  assert.ok(syncTime <= Date.now());
});

test('getMirrorStatus returns exists:true with correct age after sync', async () => {
  await syncOverleafToMirror({
    projectId: 'test-proj',
    project: { files: [{ path: 'main.tex', content: 'hello' }] },
    rootDir: tempRoot
  });
  const status = getMirrorStatus('test-proj', { rootDir: tempRoot });
  assert.strictEqual(status.exists, true);
  assert.strictEqual(status.fileCount, 1);
  assert.ok(status.ageMs >= 0);
  assert.ok(status.ageMs < 5000);
  assert.ok(status.baselineCapturedAt);
});

test('getMirrorStatus reports project key and full/partial sync timestamps', async () => {
  await syncOverleafToMirror({
    projectId: 'test-proj',
    project: { capabilities: { fullProjectSnapshot: true }, files: [{ path: 'main.tex', content: 'hello' }] },
    rootDir: tempRoot
  });
  const status = getMirrorStatus('test-proj', { rootDir: tempRoot });
  assert.equal(status.projectKey, 'test-proj');
  assert.equal(status.exists, true);
  assert.ok(status.lastFullSyncAt);
  assert.equal(status.lastPartialSyncAt || '', '');
  assert.equal(status.lastFileCount, 1);
});

test('partial sync does not update project-level freshness', async () => {
  await syncOverleafToMirror({
    projectId: 'test-proj',
    project: { capabilities: { fullProjectSnapshot: true }, files: [{ path: 'main.tex', content: 'full' }] },
    rootDir: tempRoot
  });
  const fullStatus = getMirrorStatus('test-proj', { rootDir: tempRoot });
  await syncOverleafToMirror({
    projectId: 'test-proj',
    project: { capabilities: { fullProjectSnapshot: false }, files: [{ path: 'main.tex', content: 'partial' }] },
    rootDir: tempRoot
  });
  const partialStatus = getMirrorStatus('test-proj', { rootDir: tempRoot });
  assert.equal(partialStatus.lastFullSyncAt, fullStatus.lastFullSyncAt);
  assert.ok(partialStatus.lastPartialSyncAt);
});

test('getMirrorStatus returns exists:false for unknown project', () => {
  const status = getMirrorStatus('nonexistent', { rootDir: tempRoot });
  assert.strictEqual(status.exists, false);
  assert.strictEqual(status.fileCount, 0);
});

test('applyFileOverlays writes content to workspace', async () => {
  await syncOverleafToMirror({
    projectId: 'test-proj',
    project: { files: [{ path: 'main.tex', content: 'old content' }] },
    rootDir: tempRoot
  });
  await applyFileOverlays({
    projectId: 'test-proj',
    overlays: [{ path: 'main.tex', content: 'new content', hash: 'abc123' }],
    rootDir: tempRoot
  });
  const mirror = getProjectMirror('test-proj', { rootDir: tempRoot });
  const content = fs.readFileSync(path.join(mirror.workspacePath, 'main.tex'), 'utf8');
  assert.strictEqual(content, 'new content');
});

test('applyFileOverlays updates per-file baseline but not lastFullSyncAt', async () => {
  await syncOverleafToMirror({
    projectId: 'test-proj',
    project: { files: [{ path: 'main.tex', content: 'old' }] },
    rootDir: tempRoot
  });
  const statusBefore = getMirrorStatus('test-proj', { rootDir: tempRoot });

  await applyFileOverlays({
    projectId: 'test-proj',
    overlays: [{ path: 'main.tex', content: 'new', hash: 'xyz' }],
    rootDir: tempRoot
  });

  const statusAfter = getMirrorStatus('test-proj', { rootDir: tempRoot });
  assert.strictEqual(statusAfter.baselineCapturedAt, statusBefore.baselineCapturedAt);

  const mirror = getProjectMirror('test-proj', { rootDir: tempRoot });
  const baseline = JSON.parse(fs.readFileSync(mirror.baselinePath, 'utf8'));
  const entry = baseline.files.find(f => f.path === 'main.tex');
  assert.strictEqual(entry.content, 'new');
  assert.strictEqual(entry.hash, 'xyz');
});

test('applyFileOverlays can add a new file without affecting others', async () => {
  await syncOverleafToMirror({
    projectId: 'test-proj',
    project: { files: [{ path: 'main.tex', content: 'hello' }] },
    rootDir: tempRoot
  });
  await applyFileOverlays({
    projectId: 'test-proj',
    overlays: [{ path: 'refs.bib', content: '@article{foo}' }],
    rootDir: tempRoot
  });
  const mirror = getProjectMirror('test-proj', { rootDir: tempRoot });
  assert.strictEqual(fs.readFileSync(path.join(mirror.workspacePath, 'main.tex'), 'utf8'), 'hello');
  assert.strictEqual(fs.readFileSync(path.join(mirror.workspacePath, 'refs.bib'), 'utf8'), '@article{foo}');
});

test('handleRequest mirror.status returns status for known project', async () => {
  const { handleRequest } = require('../native-host/src/taskRunner');
  await syncOverleafToMirror({
    projectId: 'test-proj',
    project: { files: [{ path: 'a.tex', content: 'x' }] },
    rootDir: tempRoot
  });
  const response = await handleRequest(
    { id: 'req1', method: 'mirror.status', params: { projectId: 'test-proj' } },
    { CODEX_OVERLEAF_MIRROR_ROOT: tempRoot }
  );
  assert.strictEqual(response.ok, true);
  assert.strictEqual(response.result.exists, true);
  assert.strictEqual(response.result.fileCount, 1);
});
