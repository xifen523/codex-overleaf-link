const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { handleRequest } = require('../native-host/src/taskRunner');

function fixtureAgentEnv(fixtureName, extra = {}) {
  return {
    CODEX_OVERLEAF_AGENT_FILE: process.execPath,
    CODEX_OVERLEAF_AGENT_ARGS_JSON: JSON.stringify([path.join(__dirname, 'fixtures', fixtureName)]),
    ...extra
  };
}

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
  delete require.cache[taskRunnerPath];
  return taskRunner;
}

test('bridge.ping returns bridge metadata', async () => {
  const response = await handleRequest({ id: '1', method: 'bridge.ping', params: {} }, {
    CODEX_OVERLEAF_CODEX_PATH: '/opt/homebrew/bin/codex',
    CODEX_OVERLEAF_LATEXMK_PATH: '/Library/TeX/texbin/latexmk'
  });

  assert.equal(response.id, '1');
  assert.equal(response.ok, true);
  assert.equal(response.result.host, 'com.codex.overleaf');
  assert.equal(response.result.platform, 'darwin');
  assert.equal(response.result.environment.codex.ok, true);
  assert.deepEqual(response.result.environment.latex.available, ['latexmk']);
});

test('codex.models returns a usable fallback model list', async () => {
  const response = await handleRequest({ id: 'models-1', method: 'codex.models', params: {} }, {});

  assert.equal(response.id, 'models-1');
  assert.equal(response.ok, true);
  assert.equal(Array.isArray(response.result.models), true);
  assert.equal(response.result.models.some(model => model.id === 'gpt-5.5'), true);
  assert.match(response.result.source, /^(codex|config|fallback|unknown)$/);
  assert.equal(typeof response.result.fetchedAt, 'string');
});

test('codex.run returns a clear error before spawning when Codex is missing', async () => {
  let calls = 0;
  const { handleRequest: handleWithFakeRunner } = loadTaskRunnerWithFakeRunner(async () => {
    calls++;
    return { status: 'completed', syncChanges: [] };
  });

  const response = await handleWithFakeRunner({
    id: 'codex-missing',
    method: 'codex.run',
    params: {
      projectId: 'missing-codex-project',
      mode: 'ask',
      task: '检查 citation',
      project: { files: [{ path: 'main.tex', content: 'hello' }] }
    }
  }, {
    CODEX_OVERLEAF_ENV_READY: '1',
    CODEX_OVERLEAF_CODEX_PATH: ''
  });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'codex_not_found');
  assert.equal(calls, 0);
});

test('codex.run rejects project snapshots without explicit freshness evidence', async () => {
  let calls = 0;
  const { handleRequest: handleWithFakeRunner } = loadTaskRunnerWithFakeRunner(async () => {
    calls++;
    return { status: 'completed', syncChanges: [] };
  });

  const response = await handleWithFakeRunner({
    id: 'codex-unverified-snapshot',
    method: 'codex.run',
    params: {
      projectId: 'unverified-codex-project',
      mode: 'ask',
      task: '检查 citation',
      project: { files: [{ path: 'main.tex', content: 'hello' }] }
    }
  }, {});

  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'codex_run_requires_snapshot_evidence');
  assert.equal(calls, 0);
});

test('codex.run accepts explicit focused partial snapshots', async () => {
  let calls = 0;
  const { handleRequest: handleWithFakeRunner } = loadTaskRunnerWithFakeRunner(async () => {
    calls++;
    return { status: 'completed', syncChanges: [] };
  });

  const response = await handleWithFakeRunner({
    id: 'codex-focused-partial',
    method: 'codex.run',
    params: {
      projectId: 'focused-partial-codex-project',
      mode: 'ask',
      task: '检查 main.tex',
      restrictToFocusFiles: true,
      focusFiles: ['main.tex'],
      project: {
        capabilities: { fullProjectSnapshot: false },
        files: [{ path: 'main.tex', content: 'hello' }]
      }
    }
  }, {});

  assert.equal(response.ok, true);
  assert.equal(calls, 1);
});

test('codex.history.clearPlugin removes only the requested plugin Codex thread history', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-history-'));
  const pluginSessionFile = path.join(home, '.codex-overleaf', 'codex-home', 'sessions', '2026', '05', '02', 'plugin.jsonl');
  const otherPluginSessionFile = path.join(home, '.codex-overleaf', 'codex-home', 'sessions', '2026', '05', '02', 'other.jsonl');
  const userSessionFile = path.join(home, '.codex', 'sessions', '2026', '05', '02', 'user.jsonl');
  try {
    fs.mkdirSync(path.dirname(pluginSessionFile), { recursive: true });
    fs.mkdirSync(path.dirname(userSessionFile), { recursive: true });
    fs.writeFileSync(pluginSessionFile, '{"threadId":"thread-a","plugin":true}\n', 'utf8');
    fs.writeFileSync(otherPluginSessionFile, '{"threadId":"thread-b","plugin":true}\n', 'utf8');
    fs.writeFileSync(userSessionFile, '{"threadId":"thread-a","user":true}\n', 'utf8');

    const response = await handleRequest({
      id: 'clear-history',
      method: 'codex.history.clearPlugin',
      params: { threadId: 'thread-a' }
    }, { HOME: home });

    assert.equal(response.ok, true);
    assert.equal(response.result.scope, 'thread');
    assert.deepEqual(response.result.removed, ['sessions/2026/05/02/plugin.jsonl']);
    assert.equal(fs.existsSync(pluginSessionFile), false);
    assert.equal(fs.existsSync(otherPluginSessionFile), true);
    assert.equal(fs.existsSync(userSessionFile), true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('task.run rejects Auto Mode when neither checkpoint nor Reviewing is verified', async () => {
  const response = await handleRequest({
    id: '2',
    method: 'task.run',
    params: {
      mode: 'auto',
      task: 'Fix citations',
      checkpoint: { ok: false },
      project: { id: 'abc', files: [] }
    }
  }, {});

  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'safety_required');
});

test('task.run accepts Auto Mode with verified Reviewing even without checkpoint', async () => {
  const response = await handleRequest({
    id: '2b',
    method: 'task.run',
    params: {
      mode: 'auto',
      task: 'Fix citations',
      checkpoint: { ok: false },
      reviewing: { ok: true },
      project: { id: 'abc', files: [] },
      proposedOperations: []
    }
  }, {});

  assert.equal(response.ok, true);
  assert.equal(response.result.status, 'completed');
  assert.equal(response.result.notes, '');
});

test('task.run rejects Auto Mode when Reviewing is only a manual override', async () => {
  const response = await handleRequest({
    id: '2c',
    method: 'task.run',
    params: {
      mode: 'auto',
      task: 'Fix citations',
      checkpoint: { ok: false },
      reviewing: { ok: true, status: 'manual-override', source: 'user-confirmed' },
      project: { id: 'abc', files: [] },
      proposedOperations: []
    }
  }, {});

  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'safety_required');
});

test('task.run returns summary-only confirmation for Confirm Mode', async () => {
  const response = await handleRequest({
    id: '3',
    method: 'task.run',
    params: {
      mode: 'confirm',
      task: 'Prepare appendix',
      project: { id: 'abc', files: [{ path: 'main.tex', content: 'hello' }] },
      proposedOperations: [
        { type: 'edit', path: 'main.tex', hunks: [{ before: 'hello', after: 'hello world' }] }
      ]
    }
  }, {});

  assert.equal(response.ok, true);
  assert.equal(response.result.status, 'requires_task_confirmation');
  assert.equal(response.result.summary.counts.edit, 1);
  assert.equal(typeof response.result.planId, 'string');
  assert.equal(Array.isArray(response.result.operations), false);
  assert.equal(JSON.stringify(response.result).includes('hello world'), false);
});

test('task.run in Ask Mode returns analysis without write operations', async () => {
  const response = await handleRequest({
    id: '3b',
    method: 'task.run',
    params: {
      mode: 'ask',
      task: 'Explain citation issues',
      project: { id: 'abc', files: [{ path: 'main.tex', content: 'hello' }] },
      proposedOperations: [
        { type: 'edit', path: 'main.tex', hunks: [{ before: 'hello', after: 'hello world' }] }
      ]
    }
  }, {});

  assert.equal(response.ok, true);
  assert.equal(response.result.status, 'completed');
  assert.deepEqual(response.result.operations, []);
  assert.equal(response.result.summary.counts.edit, 0);
  assert.equal(JSON.stringify(response.result).includes('hello world'), false);
});

test('task.run default results include a minimal user report', async () => {
  const response = await handleRequest({
    id: '3bb',
    method: 'task.run',
    params: {
      mode: 'ask',
      task: 'Explain citation issues',
      project: { id: 'abc', files: [{ path: 'main.tex', content: 'hello' }] },
      proposedOperations: []
    }
  }, {});

  assert.equal(response.ok, true);
  assert.equal(response.result.userReport.conclusion, '这轮任务已完成，没有写入 Overleaf 文件。');
  assert.deepEqual(response.result.userReport.checked, ['main.tex']);
  assert.equal(response.result.userReport.nextStep, '可以继续追问，或加入更多 @context 后再检查。');
});

test('task.run in Ask Mode strips external-agent pending write operations', async () => {
  const response = await handleRequest({
    id: '3c',
    method: 'task.run',
    params: {
      mode: 'ask',
      task: 'Explain pending citation fix',
      project: { id: 'abc', files: [{ path: 'main.tex', content: 'old' }] }
    }
  }, fixtureAgentEnv('agentConfirmPending.cjs'));

  assert.equal(response.ok, true);
  assert.equal(response.result.status, 'completed');
  assert.deepEqual(response.result.operations, []);
  assert.equal(Object.hasOwn(response.result, 'pendingOperations'), false);
  assert.equal(Object.hasOwn(response.result, 'deletePlan'), false);
});

test('task.run in Ask Mode preserves external-agent userReport', async () => {
  const response = await handleRequest({
    id: '3d',
    method: 'task.run',
    params: {
      mode: 'ask',
      task: 'Check citations',
      project: { id: 'abc', files: [{ path: 'main.tex', content: '\\cite{x}' }] }
    }
  }, fixtureAgentEnv('agentUserReport.cjs'));

  assert.equal(response.ok, true);
  assert.equal(response.result.userReport.conclusion, '没有发现缺失 citation key，也没有修改文件。');
  assert.deepEqual(response.result.userReport.findings, ['所有 citation key 都能在 .bib 中找到。']);
  assert.deepEqual(response.result.operations, []);
});

test('Confirm Mode redaction keeps userReport while hiding operations', async () => {
  const response = await handleRequest({
    id: '3e',
    method: 'task.run',
    params: {
      mode: 'confirm',
      task: 'Prepare grammar edit',
      project: { id: 'abc', files: [{ path: 'main.tex', content: 'old' }] }
    }
  }, fixtureAgentEnv('agentUserReportWithOps.cjs'));

  assert.equal(response.ok, true);
  assert.equal(response.result.status, 'requires_task_confirmation');
  assert.equal(typeof response.result.planId, 'string');
  assert.equal(Array.isArray(response.result.operations), false);
  assert.equal(response.result.userReport.conclusion, '我准备修改 main.tex 中的一句话，让语法更自然。');
  assert.deepEqual(response.result.userReport.plannedChanges, ['main.tex：编辑摘要中的一句话。']);
});

test('task.confirm returns stored operations after task-level approval', async () => {
  const response = await handleRequest({
    id: '5',
    method: 'task.run',
    params: {
      mode: 'confirm',
      task: 'Prepare appendix',
      project: { id: 'abc', files: [{ path: 'main.tex', content: 'hello' }] },
      proposedOperations: [
        { type: 'edit', path: 'main.tex', hunks: [{ before: 'hello', after: 'hello world' }] }
      ]
    }
  }, {});

  const confirmed = await handleRequest({
    id: '6',
    method: 'task.confirm',
    params: {
      planId: response.result.planId
    }
  }, {});

  assert.equal(confirmed.ok, true);
  assert.deepEqual(confirmed.result.operations, [
    { type: 'edit', path: 'main.tex', hunks: [{ before: 'hello', after: 'hello world' }] }
  ]);
});

test('unknown methods return a structured error', async () => {
  const response = await handleRequest({ id: '4', method: 'nope', params: {} }, {});

  assert.deepEqual(response, {
    id: '4',
    ok: false,
    error: {
      code: 'method_not_found',
      message: 'Unknown method: nope'
    }
  });
});

test('Auto Mode pauses external-agent delete operations behind a delete plan', async () => {
  const response = await handleRequest({
    id: '7',
    method: 'task.run',
    params: {
      mode: 'auto',
      task: 'Clean project',
      checkpoint: { ok: true },
      project: { id: 'abc', files: [] }
    }
  }, fixtureAgentEnv('agentDelete.cjs'));

  assert.equal(response.ok, true);
  assert.equal(response.result.status, 'delete_plan_required');
  assert.deepEqual(response.result.operations, [
    { type: 'edit', path: 'main.tex', find: 'a', replace: 'b' }
  ]);
  assert.deepEqual(response.result.deletePlan, [
    { path: 'unused.tex', reason: 'not referenced' }
  ]);
});

test('Confirm Mode forces external-agent operations behind task confirmation', async () => {
  const response = await handleRequest({
    id: '7b',
    method: 'task.run',
    params: {
      mode: 'confirm',
      task: 'Edit main',
      project: { id: 'abc', files: [{ path: 'main.tex', content: 'old' }] }
    }
  }, fixtureAgentEnv('agentCompletedWithOps.cjs'));

  assert.equal(response.ok, true);
  assert.equal(response.result.status, 'requires_task_confirmation');
  assert.equal(typeof response.result.planId, 'string');
  assert.equal(Array.isArray(response.result.operations), false);
  assert.equal(response.result.summary.counts.edit, 1);
});

test('Confirm Mode forces external-agent pendingOperations behind task confirmation', async () => {
  const response = await handleRequest({
    id: '7bb',
    method: 'task.run',
    params: {
      mode: 'confirm',
      task: 'Edit pending',
      project: { id: 'abc', files: [{ path: 'main.tex', content: 'old' }] }
    }
  }, fixtureAgentEnv('agentConfirmPending.cjs'));

  assert.equal(response.ok, true);
  assert.equal(response.result.status, 'requires_task_confirmation');
  assert.equal(typeof response.result.planId, 'string');
  assert.equal(Array.isArray(response.result.operations), false);
  assert.equal(Array.isArray(response.result.pendingOperations), false);
  assert.equal(response.result.summary.counts.edit, 1);
});

test('Auto Mode re-splits unsafe delete_plan_required agent operations', async () => {
  const response = await handleRequest({
    id: '7c',
    method: 'task.run',
    params: {
      mode: 'auto',
      task: 'Unsafe clean',
      checkpoint: { ok: true },
      project: { id: 'abc', files: [] }
    }
  }, fixtureAgentEnv('agentDeletePlanUnsafe.cjs'));

  assert.equal(response.ok, true);
  assert.equal(response.result.status, 'delete_plan_required');
  assert.deepEqual(response.result.operations, []);
  assert.deepEqual(response.result.deletePlan, [
    { path: 'unused.tex', reason: 'not referenced' }
  ]);
  assert.deepEqual(response.result.pendingOperations, [
    { type: 'delete', path: 'unused.tex', reason: 'not referenced' }
  ]);
});

test('task.run returns external-agent notes for analysis-only tasks', async () => {
  const response = await handleRequest({
    id: '8',
    method: 'task.run',
    params: {
      mode: 'auto',
      task: 'Check citations only',
      checkpoint: { ok: false },
      reviewing: { ok: true },
      project: { id: 'abc', files: [{ path: 'main.tex', content: '\\cite{x}' }] }
    }
  }, fixtureAgentEnv('agentNotes.cjs'));

  assert.equal(response.ok, true);
  assert.equal(response.result.status, 'completed');
  assert.equal(response.result.notes, 'No obvious citation issues found in the supplied files.');
  assert.deepEqual(response.result.operations, []);
});

test('task.run starts an external agent from file and args without shell command strings', async () => {
  const response = await handleRequest({
    id: '8b',
    method: 'task.run',
    params: {
      mode: 'auto',
      task: 'Check citations only',
      checkpoint: { ok: false },
      reviewing: { ok: true },
      project: { id: 'abc', files: [{ path: 'main.tex', content: '\\cite{x}' }] }
    }
  }, {
    CODEX_OVERLEAF_AGENT_FILE: process.execPath,
    CODEX_OVERLEAF_AGENT_ARGS_JSON: JSON.stringify([path.join(__dirname, 'fixtures/agentNotes.cjs')])
  });

  assert.equal(response.ok, true);
  assert.equal(response.result.notes, 'No obvious citation issues found in the supplied files.');
});

test('task.run ignores legacy shell command env var', async () => {
  const response = await handleRequest({
    id: '8c',
    method: 'task.run',
    params: {
      mode: 'ask',
      task: 'Check citations only',
      project: { id: 'abc', files: [{ path: 'main.tex', content: '\\cite{x}' }] }
    }
  }, {
    CODEX_OVERLEAF_AGENT_CMD: `${process.execPath} ${path.join(__dirname, 'fixtures/agentNotes.cjs')}`
  });

  assert.equal(response.ok, true);
  assert.equal(response.result.status, 'completed');
  assert.notEqual(response.result.notes, 'No obvious citation issues found in the supplied files.');
  assert.deepEqual(response.result.operations, []);
});

test('Confirm Mode plan ids use random UUIDs', async () => {
  const response = await handleRequest({
    id: '8d',
    method: 'task.run',
    params: {
      mode: 'confirm',
      task: 'Prepare appendix',
      project: { id: 'abc', files: [{ path: 'main.tex', content: 'hello' }] },
      proposedOperations: [
        { type: 'edit', path: 'main.tex', hunks: [{ before: 'hello', after: 'hello world' }] }
      ]
    }
  }, {});

  assert.equal(response.ok, true);
  assert.match(response.result.planId, /^plan_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test('task.run emits realtime lifecycle events while external agent runs', async () => {
  const events = [];
  const response = await handleRequest({
    id: '9',
    method: 'task.run',
    params: {
      mode: 'auto',
      task: 'Check citations only',
      checkpoint: { ok: false },
      reviewing: { ok: true },
      project: { id: 'abc', files: [{ path: 'main.tex', content: '\\cite{x}' }] },
      model: 'gpt-5.5',
      reasoningEffort: 'xhigh'
    }
  }, fixtureAgentEnv('agentProgress.cjs'), event => events.push(event));

  assert.equal(response.ok, true);
  assert.equal(response.result.notes, 'Progress fixture completed.');
  assert.deepEqual(events.map(event => event.type), [
    'native.task.received',
    'agent.command.started',
    'codex.exec.started',
    'agent.command.completed'
  ]);
  assert.equal(events[1].detail.model, 'gpt-5.5');
  assert.equal(events[2].detail.pid, 1234);
});

test('task.run fails a hanging external agent after the configured timeout', async () => {
  const response = await handleRequest({
    id: '10',
    method: 'task.run',
    params: {
      mode: 'confirm',
      task: 'Hang',
      project: { id: 'abc', files: [] }
    }
  }, fixtureAgentEnv('agentHang.cjs', {
    CODEX_OVERLEAF_AGENT_TIMEOUT_MS: '50'
  }));

  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'agent_failed');
  assert.match(response.error.message, /timed out/i);
});

test('task.run fails an external agent that exceeds the output byte limit', async () => {
  const response = await handleRequest({
    id: '11',
    method: 'task.run',
    params: {
      mode: 'confirm',
      task: 'Too much output',
      project: { id: 'abc', files: [] }
    }
  }, fixtureAgentEnv('agentHugeStdout.cjs', {
    CODEX_OVERLEAF_AGENT_OUTPUT_MAX_BYTES: '1024'
  }));

  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'agent_failed');
  assert.match(response.error.message, /output limit/i);
});
