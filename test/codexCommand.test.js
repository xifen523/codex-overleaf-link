const assert = require('node:assert/strict');
const test = require('node:test');

const {
  resolveCodexCommand,
  shouldUseShellForCommand
} = require('../native-host/src/codexCommand');

test('resolveCodexCommand refreshes a stale Codex Desktop version path before a run', () => {
  const oldCommand = 'C:\\Users\\alice\\AppData\\Local\\OpenAI\\Codex\\bin\\old\\codex.exe';
  const newCommand = 'C:\\Users\\alice\\AppData\\Local\\OpenAI\\Codex\\bin\\new\\codex.exe';
  const env = {
    CODEX_OVERLEAF_ENV_READY: '1',
    CODEX_OVERLEAF_CODEX_PATH: oldCommand,
    PATH: 'old-path'
  };
  let refreshes = 0;

  const command = resolveCodexCommand(env, {
    existsSync: candidate => candidate === newCommand,
    buildNativeRuntimeEnv(current) {
      refreshes += 1;
      assert.equal(current.CODEX_OVERLEAF_CODEX_PATH, oldCommand);
      return {
        ...current,
        CODEX_OVERLEAF_CODEX_PATH: newCommand,
        PATH: 'refreshed-path'
      };
    }
  });

  assert.equal(command, newCommand);
  assert.equal(env.CODEX_OVERLEAF_CODEX_PATH, newCommand);
  assert.equal(env.PATH, 'refreshed-path');
  assert.equal(refreshes, 1);
});

test('resolveCodexCommand preserves an explicit missing command without using ambient state', () => {
  const env = {
    CODEX_OVERLEAF_ENV_READY: '1',
    CODEX_OVERLEAF_CODEX_PATH: ''
  };
  let refreshes = 0;

  assert.equal(resolveCodexCommand(env, {
    existsSync: () => false,
    buildNativeRuntimeEnv: () => { refreshes += 1; }
  }), '');
  assert.equal(refreshes, 0);
});

test('resolveCodexCommand keeps a valid prepared command without rescanning', () => {
  let refreshes = 0;
  const command = resolveCodexCommand({
    CODEX_OVERLEAF_ENV_READY: '1',
    CODEX_OVERLEAF_CODEX_PATH: 'C:\\valid\\codex.exe'
  }, {
    existsSync: () => true,
    buildNativeRuntimeEnv: () => {
      refreshes += 1;
      return {};
    }
  });

  assert.equal(command, 'C:\\valid\\codex.exe');
  assert.equal(refreshes, 0);
});

test('unprepared command resolution and Windows shell selection preserve CLI behavior', () => {
  assert.equal(resolveCodexCommand({}), 'codex');
  assert.equal(shouldUseShellForCommand('codex', { CODEX_OVERLEAF_PLATFORM: 'win32' }), true);
  assert.equal(shouldUseShellForCommand('C:\\Codex\\codex.exe', { CODEX_OVERLEAF_PLATFORM: 'win32' }), false);
});
