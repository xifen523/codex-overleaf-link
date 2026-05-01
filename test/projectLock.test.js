const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { handleRequest } = require('../native-host/src/taskRunner');
const { getProjectMirror } = require('../native-host/src/mirrorWorkspace');

test('mirror.sync is rejected while codex.run holds the project lock', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-lock-'));
  const env = { CODEX_OVERLEAF_MIRROR_ROOT: rootDir, CODEX_OVERLEAF_AGENT_CMD: undefined };
  const events = [];

  const codexRunPromise = handleRequest({
    id: 'run-1',
    method: 'codex.run',
    params: {
      projectId: 'lock-test',
      mode: 'ask',
      task: 'check',
      project: { files: [{ path: 'main.tex', content: 'hello' }] }
    }
  }, env, event => events.push(event));

  // Give codex.run a moment to acquire the lock
  await new Promise(r => setTimeout(r, 20));

  const syncResponse = await handleRequest({
    id: 'sync-1',
    method: 'mirror.sync',
    params: {
      projectId: 'lock-test',
      project: { files: [{ path: 'main.tex', content: 'overwrite attempt' }] }
    }
  }, env);

  assert.equal(syncResponse.ok, false);
  assert.equal(syncResponse.error.code, 'project_locked');

  // Let codex.run finish
  const runResponse = await codexRunPromise;
  assert.equal(runResponse.ok, true);

  // After codex.run finishes, mirror.sync should work
  const syncAfter = await handleRequest({
    id: 'sync-2',
    method: 'mirror.sync',
    params: {
      projectId: 'lock-test',
      project: { files: [{ path: 'main.tex', content: 'safe now' }] }
    }
  }, env);

  assert.equal(syncAfter.ok, true);
  assert.equal(syncAfter.result.fileCount, 1);

  fs.rmSync(rootDir, { recursive: true, force: true });
});

test('mirror.sync works for a different project while codex.run is active', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-lock-'));
  const env = { CODEX_OVERLEAF_MIRROR_ROOT: rootDir, CODEX_OVERLEAF_AGENT_CMD: undefined };

  const codexRunPromise = handleRequest({
    id: 'run-2',
    method: 'codex.run',
    params: {
      projectId: 'project-a',
      mode: 'ask',
      task: 'check',
      project: { files: [{ path: 'main.tex', content: 'a' }] }
    }
  }, env, () => {});

  await new Promise(r => setTimeout(r, 20));

  const syncResponse = await handleRequest({
    id: 'sync-3',
    method: 'mirror.sync',
    params: {
      projectId: 'project-b',
      project: { files: [{ path: 'main.tex', content: 'b content' }] }
    }
  }, env);

  assert.equal(syncResponse.ok, true);
  assert.equal(syncResponse.result.fileCount, 1);

  await codexRunPromise;
  fs.rmSync(rootDir, { recursive: true, force: true });
});
