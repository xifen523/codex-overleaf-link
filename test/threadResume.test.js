const { test } = require('node:test');
const assert = require('node:assert');
const { buildThreadStartParams, buildThreadResumeParams, buildCodexSettings } = require('../native-host/src/codexSessionRunner');

test('buildThreadStartParams does not include threadId', () => {
  const params = buildThreadStartParams({
    workspacePath: '/tmp/ws',
    model: 'gpt-5.4',
    approvalPolicy: 'never',
    sandboxMode: 'workspace-write'
  });
  assert.strictEqual(params.cwd, '/tmp/ws');
  assert.strictEqual(params.model, 'gpt-5.4');
  assert.strictEqual(params.approvalPolicy, 'never');
  assert.strictEqual(params.sandbox, 'workspace-write');
  assert.strictEqual(params.threadId, undefined);
});

test('buildThreadResumeParams includes threadId', () => {
  const params = buildThreadResumeParams({
    threadId: 'thread_abc123',
    workspacePath: '/tmp/ws',
    model: 'gpt-5.4',
    approvalPolicy: 'never',
    sandboxMode: 'workspace-write'
  });
  assert.strictEqual(params.threadId, 'thread_abc123');
  assert.strictEqual(params.cwd, '/tmp/ws');
  assert.strictEqual(params.model, 'gpt-5.4');
  assert.strictEqual(params.approvalPolicy, 'never');
  assert.strictEqual(params.sandbox, 'workspace-write');
});

test('buildThreadResumeParams with empty threadId', () => {
  const params = buildThreadResumeParams({
    threadId: '',
    workspacePath: '/tmp/ws'
  });
  assert.strictEqual(params.threadId, '');
  assert.strictEqual(params.cwd, '/tmp/ws');
});

test('buildThreadResumeParams defaults model to null', () => {
  const params = buildThreadResumeParams({
    threadId: 'thread_xyz',
    workspacePath: '/tmp/ws'
  });
  assert.strictEqual(params.model, null);
});
