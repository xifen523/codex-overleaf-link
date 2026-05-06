const assert = require('node:assert/strict');
const test = require('node:test');

const { buildLauncher, buildLauncherScript } = require('../native-host/src/launcher');

test('builds a macOS launcher with absolute Node and default Codex agent file', () => {
  const script = buildLauncherScript({
    nodePath: '/opt/homebrew/bin/node',
    bridgeEntryPath: '/app/native-host/src/index.js',
    agentPath: '/app/scripts/codex-json-agent.mjs'
  });

  assert.match(script, /^#!\/bin\/sh/);
  assert.doesNotMatch(script, /CODEX_OVERLEAF_AGENT_CMD/);
  assert.match(script, /CODEX_OVERLEAF_AGENT_FILE=/);
  assert.match(script, /CODEX_OVERLEAF_AGENT_ARGS_JSON=/);
  assert.match(script, /\/opt\/homebrew\/bin\/node/);
  assert.match(script, /\/app\/scripts\/codex-json-agent\.mjs/);
  assert.match(script, /\/Library\/TeX\/texbin/);
  assert.match(script, /exec "\/opt\/homebrew\/bin\/node" "\/app\/native-host\/src\/index\.js"/);
  assert.doesNotMatch(script, /\/Users\/[^/]+\//);
});

test('quotes launcher agent file and args for paths containing spaces', () => {
  const script = buildLauncherScript({
    nodePath: '/Applications/Node Bin/node',
    bridgeEntryPath: '/app/native-host/src/index.js',
    agentPath: '/Users/me/My Project/scripts/codex-json-agent.mjs'
  });

  assert.match(script, /CODEX_OVERLEAF_AGENT_FILE='\/Applications\/Node Bin\/node'/);
  assert.match(script, /CODEX_OVERLEAF_AGENT_ARGS_JSON='\["\/Users\/me\/My Project\/scripts\/codex-json-agent\.mjs"\]'/);
});

test('builds a Windows launcher that quotes paths containing spaces', () => {
  const script = buildLauncher({
    platform: 'win32',
    nodePath: 'C:\\Program Files\\nodejs\\node.exe',
    bridgeEntryPath: 'C:\\Users\\Alice\\Codex Overleaf\\native-host\\src\\index.js',
    agentPath: 'C:\\Users\\Alice\\Codex Overleaf\\scripts\\codex-json-agent.mjs'
  });

  assert.match(script, /^@echo off/);
  assert.match(script, /set "CODEX_OVERLEAF_AGENT_FILE=C:\\Program Files\\nodejs\\node\.exe"/);
  assert.ok(script.includes(`set CODEX_OVERLEAF_AGENT_ARGS_JSON=${JSON.stringify([
    'C:\\Users\\Alice\\Codex Overleaf\\scripts\\codex-json-agent.mjs'
  ])}`));
  assert.match(script, /"C:\\Program Files\\nodejs\\node\.exe" "C:\\Users\\Alice\\Codex Overleaf\\native-host\\src\\index\.js"/);
});
