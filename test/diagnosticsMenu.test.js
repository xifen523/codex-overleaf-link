const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('project snapshot action lives in the diagnostics menu instead of the header actions', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );

  assert.equal(contentScript.includes('data-snapshot'), false);
  assert.match(contentScript, /data-diagnostics-menu/);
  assert.match(contentScript, /data-diagnostics-native-env/);
  assert.match(contentScript, /data-diagnostics-page-state/);
  assert.match(contentScript, /data-diagnostics-snapshot/);
  assert.match(contentScript, /function inspectNativeEnvironment\(/);
  assert.match(contentScript, /function formatNativeEnvironmentLog\(/);
  assert.match(contentScript, /本机环境诊断/);
  assert.match(contentScript, /function toggleDiagnosticsMenu\(/);
  assert.match(contentScript, /function closeDiagnosticsMenu\(/);
  assert.match(contentScript, /function inspectProjectSnapshot\(/);
  assert.match(contentScript, /allowEditorNavigation:\s*false/);
  assert.match(css, /\.codex-diagnostics-menu/);
});
