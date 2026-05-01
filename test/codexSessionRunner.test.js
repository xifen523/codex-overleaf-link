const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { buildThreadStartParams, runCodexSession } = require('../native-host/src/codexSessionRunner');

test('runs Codex against a local mirror and returns sync changes instead of operation JSON', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-session-'));
  const events = [];
  try {
    const result = await runCodexSession({
      params: {
        projectId: 'project-session',
        task: '润色 main.tex',
        mode: 'auto',
        model: 'gpt-5.5',
        reasoningEffort: 'xhigh',
        project: {
          files: [
            { path: 'main.tex', content: 'Before' }
          ]
        }
      },
      rootDir,
      emit: event => events.push(event),
      executeCodex: async ({ workspacePath, emit }) => {
        emit({
          type: 'codex.session.event',
          title: 'item/agentMessage/delta',
          status: 'running',
          detail: {
            method: 'item/agentMessage/delta',
            params: { delta: '我会直接编辑本地 mirror。' }
          }
        });
        fs.writeFileSync(path.join(workspacePath, 'main.tex'), 'After', 'utf8');
      }
    });

    assert.equal(result.status, 'completed');
    assert.equal(typeof result.workspacePath, 'string');
    assert.deepEqual(result.syncChanges.map(change => [change.type, change.path, change.content]), [
      ['write', 'main.tex', 'After']
    ]);
    assert.equal(Object.hasOwn(result, 'operations'), false);
    assert.equal(Object.hasOwn(result, 'userReport'), false);
    assert.equal(events.some(event => event.type === 'overleaf.sync.started'), true);
    assert.equal(events.some(event => event.type === 'codex.session.event'), true);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('passes Codex mode, model, and reasoning settings to the runner boundary', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-session-'));
  let received = null;
  try {
    await runCodexSession({
      params: {
        projectId: 'project-settings',
        task: '检查 citation',
        mode: 'ask',
        model: 'gpt-5.4',
        reasoningEffort: 'high',
        project: { files: [{ path: 'main.tex', content: 'Hello' }] }
      },
      rootDir,
      emit: () => {},
      executeCodex: async input => {
        received = input;
      }
    });

    assert.equal(received.task, '检查 citation');
    assert.equal(received.mode, 'ask');
    assert.equal(received.model, 'gpt-5.4');
    assert.equal(received.reasoningEffort, 'high');
    assert.equal(received.sandboxMode, 'read-only');
    assert.equal(received.approvalPolicy, 'never');
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('thread start params avoid experimental app-server capabilities', () => {
  const params = buildThreadStartParams({
    workspacePath: '/tmp/overleaf-mirror',
    model: 'gpt-5.5',
    approvalPolicy: 'never',
    sandboxMode: 'read-only'
  });

  assert.deepEqual(params, {
    cwd: '/tmp/overleaf-mirror',
    model: 'gpt-5.5',
    approvalPolicy: 'never',
    sandbox: 'read-only',
    experimentalRawEvents: false
  });
  assert.equal(Object.hasOwn(params, 'persistExtendedHistory'), false);
  assert.equal(Object.hasOwn(params, 'persistFullHistory'), false);
});
