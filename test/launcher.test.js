const assert = require('node:assert/strict');
const test = require('node:test');

const { buildLauncherScript } = require('../native-host/src/launcher');

test('builds a macOS launcher with absolute Node and default Codex agent command', () => {
  const script = buildLauncherScript({
    nodePath: '/opt/homebrew/bin/node',
    bridgeEntryPath: '/app/native-host/src/index.js',
    agentPath: '/app/scripts/codex-json-agent.mjs'
  });

  assert.match(script, /^#!\/bin\/sh/);
  assert.match(script, /CODEX_OVERLEAF_AGENT_CMD=/);
  assert.match(script, /CODEX_OVERLEAF_AGENT_FILE=/);
  assert.match(script, /CODEX_OVERLEAF_AGENT_ARGS_JSON=/);
  assert.match(script, /\/opt\/homebrew\/bin\/node/);
  assert.match(script, /\/app\/scripts\/codex-json-agent\.mjs/);
  assert.match(script, /\/Library\/TeX\/texbin/);
  assert.match(script, /exec "\/opt\/homebrew\/bin\/node" "\/app\/native-host\/src\/index\.js"/);
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
