const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('contentScript delegates panel construction to focused content modules', () => {
  const contentScript = read('extension/src/content/contentRuntime.js');

  assert.match(contentScript, /CodexOverleafPanelRenderer/);
  assert.match(contentScript, /CodexOverleafSessionPanel/);
  assert.match(contentScript, /CodexOverleafSettingsPanel/);
  assert.match(contentScript, /CodexOverleafDiagnosticsPanel/);
  assert.match(contentScript, /CodexOverleafComposerPanel/);
  assert.match(contentScript, /PanelRenderer\.create/);
  assert.match(contentScript, /SessionPanel\.create/);
  assert.match(contentScript, /SettingsPanel\.create/);
  assert.match(contentScript, /DiagnosticsPanel\.create/);
  assert.match(contentScript, /ComposerPanel\.create/);
  assert.doesNotMatch(contentScript, /panel\.innerHTML\s*=\s*`/);
});

test('new content modules expose the v1 panel API globals', () => {
  const modules = {
    panelRenderer: read('extension/src/content/panelRenderer.js'),
    sessionPanel: read('extension/src/content/sessionPanel.js'),
    settingsPanel: read('extension/src/content/settingsPanel.js'),
    diagnosticsPanel: read('extension/src/content/diagnosticsPanel.js'),
    composerPanel: read('extension/src/content/composerPanel.js')
  };

  assert.match(modules.panelRenderer, /window\.CodexOverleafPanelRenderer\s*=\s*\{/);
  assert.match(modules.panelRenderer, /create,/);
  assert.match(modules.panelRenderer, /setVisible,/);
  assert.match(modules.panelRenderer, /setBadge,/);

  assert.match(modules.sessionPanel, /window\.CodexOverleafSessionPanel\s*=\s*\{/);
  assert.match(modules.sessionPanel, /create,/);
  assert.match(modules.sessionPanel, /update,/);
  assert.match(modules.sessionPanel, /getDisplayTitle/);

  assert.match(modules.settingsPanel, /window\.CodexOverleafSettingsPanel\s*=\s*\{/);
  assert.match(modules.settingsPanel, /create,/);
  assert.match(modules.settingsPanel, /loadState,/);
  assert.match(modules.settingsPanel, /readState,/);

  assert.match(modules.diagnosticsPanel, /window\.CodexOverleafDiagnosticsPanel\s*=\s*\{/);
  assert.match(modules.diagnosticsPanel, /create,/);
  assert.match(modules.diagnosticsPanel, /updateStatus,/);
  assert.match(modules.diagnosticsPanel, /showResult/);

  assert.match(modules.composerPanel, /window\.CodexOverleafComposerPanel\s*=\s*\{/);
  assert.match(modules.composerPanel, /create,/);
  assert.match(modules.composerPanel, /setState,/);
  assert.match(modules.composerPanel, /setModels/);
});

test('session rows are rendered with DOM APIs in the extracted session panel', () => {
  const sessionPanel = read('extension/src/content/sessionPanel.js');
  const renderRow = sessionPanel.match(/function renderSessionRow\(instance, session\) \{[\s\S]*?\n  function beginRename/)?.[0] || '';

  assert.match(renderRow, /document\.createElement\('button'\)/);
  assert.match(renderRow, /row\.dataset\.active/);
  assert.match(renderRow, /row\.dataset\.running/);
  assert.match(sessionPanel, /callbacks\.onRename/);
  assert.doesNotMatch(renderRow, /innerHTML\s*=/);
});
