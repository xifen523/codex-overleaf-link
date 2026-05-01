const assert = require('node:assert/strict');
const test = require('node:test');

const { buildCodexExecArgs } = require('../native-host/src/codexArgs');

test('builds Codex CLI args with selected model and reasoning effort', () => {
  const args = buildCodexExecArgs({
    cwd: '/tmp/project',
    schemaPath: '/tmp/schema.json',
    outputPath: '/tmp/out.json',
    model: 'gpt-5.4',
    reasoningEffort: 'high'
  });

  assert.equal(args.includes('-m'), true);
  assert.equal(args.includes('gpt-5.4'), true);
  assert.equal(args.includes('-c'), true);
  assert.equal(args.includes('model_reasoning_effort="high"'), true);
});

test('places approval policy before exec for current Codex CLI', () => {
  const args = buildCodexExecArgs({
    cwd: '/tmp/project',
    schemaPath: '/tmp/schema.json',
    outputPath: '/tmp/out.json'
  });

  assert.deepEqual(args.slice(0, 3), ['--ask-for-approval', 'never', 'exec']);
});

test('enables Codex JSONL event stream while preserving final output file', () => {
  const args = buildCodexExecArgs({
    cwd: '/tmp/project',
    schemaPath: '/tmp/schema.json',
    outputPath: '/tmp/out.json'
  });

  assert.equal(args.includes('--json'), true);
  assert.equal(args.includes('--output-last-message'), true);
});

test('omits model and reasoning args when unset', () => {
  const args = buildCodexExecArgs({
    cwd: '/tmp/project',
    schemaPath: '/tmp/schema.json',
    outputPath: '/tmp/out.json'
  });

  assert.equal(args.includes('-m'), false);
  assert.equal(args.includes('model_reasoning_effort="high"'), false);
});
