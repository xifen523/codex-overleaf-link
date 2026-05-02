const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { getProjectMirror } = require('../native-host/src/mirrorWorkspace');

function loadTaskRunnerWithFakeRunner(fakeRunner) {
  const runnerPath = require.resolve('../native-host/src/codexSessionRunner');
  const taskRunnerPath = require.resolve('../native-host/src/taskRunner');
  const originalRunner = require(runnerPath);

  delete require.cache[taskRunnerPath];
  require.cache[runnerPath].exports = {
    ...originalRunner,
    runCodexSession: fakeRunner
  };

  const taskRunner = require(taskRunnerPath);
  require.cache[runnerPath].exports = originalRunner;
  return taskRunner;
}

function createBlockingRunner() {
  let release;
  const calls = [];
  const started = new Promise(resolveStarted => {
    release = async () => {};
    calls.releaseFirst = () => release();
    calls.started = resolveStarted;
  });

  async function runCodexSession(input) {
    calls.push(input);
    calls.started();
    if (calls.length === 1) {
      await new Promise(resolve => {
        release = resolve;
      });
    }
    return {
      status: 'completed',
      syncChanges: [],
      projectId: input.params?.projectId || 'project',
      workspacePath: path.join(input.rootDir || os.tmpdir(), 'workspace')
    };
  }

  return {
    calls,
    started,
    runCodexSession,
    releaseFirst: () => calls.releaseFirst()
  };
}

test('mirror.sync is rejected while codex.run holds the project lock', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-lock-'));
  const env = { CODEX_OVERLEAF_MIRROR_ROOT: rootDir, CODEX_OVERLEAF_AGENT_CMD: undefined };
  const runner = createBlockingRunner();
  const { handleRequest } = loadTaskRunnerWithFakeRunner(runner.runCodexSession);

  try {
    const codexRunPromise = handleRequest({
      id: 'run-1',
      method: 'codex.run',
      params: {
        projectId: 'lock-test',
        mode: 'ask',
        task: 'check',
        project: { files: [{ path: 'main.tex', content: 'hello' }] }
      }
    }, env);

    await runner.started;

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

    runner.releaseFirst();
    const runResponse = await codexRunPromise;
    assert.equal(runResponse.ok, true);

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
  } finally {
    runner.releaseFirst();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('mirror.sync works for a different project while codex.run is active', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-lock-'));
  const env = { CODEX_OVERLEAF_MIRROR_ROOT: rootDir, CODEX_OVERLEAF_AGENT_CMD: undefined };
  const runner = createBlockingRunner();
  const { handleRequest } = loadTaskRunnerWithFakeRunner(runner.runCodexSession);

  try {
    const codexRunPromise = handleRequest({
      id: 'run-2',
      method: 'codex.run',
      params: {
        projectId: 'project-a',
        mode: 'ask',
        task: 'check',
        project: { files: [{ path: 'main.tex', content: 'a' }] }
      }
    }, env);

    await runner.started;

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

    runner.releaseFirst();
    await codexRunPromise;
  } finally {
    runner.releaseFirst();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('codex.run is rejected while another codex.run holds the same project lock', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-lock-'));
  const env = { CODEX_OVERLEAF_MIRROR_ROOT: rootDir, CODEX_OVERLEAF_AGENT_CMD: undefined };
  const runner = createBlockingRunner();
  const { handleRequest } = loadTaskRunnerWithFakeRunner(runner.runCodexSession);

  try {
    const firstRun = handleRequest({
      id: 'run-same-1',
      method: 'codex.run',
      params: {
        projectId: 'same-project',
        mode: 'ask',
        task: 'first',
        project: { files: [{ path: 'main.tex', content: 'a' }] }
      }
    }, env);

    await runner.started;

    const secondRun = await handleRequest({
      id: 'run-same-2',
      method: 'codex.run',
      params: {
        projectId: 'same-project',
        mode: 'ask',
        task: 'second',
        project: { files: [{ path: 'main.tex', content: 'b' }] }
      }
    }, env);

    assert.equal(secondRun.ok, false);
    assert.equal(secondRun.error.code, 'project_locked');
    assert.equal(runner.calls.length, 1, 'second codex.run should not enter the runner');

    runner.releaseFirst();
    const firstResponse = await firstRun;
    assert.equal(firstResponse.ok, true);
  } finally {
    runner.releaseFirst();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
