const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('popup checks native host status and offers a copyable install command', () => {
  const popupHtml = fs.readFileSync(path.join(__dirname, '../extension/popup.html'), 'utf8');
  const popupJs = fs.readFileSync(path.join(__dirname, '../extension/src/popup.js'), 'utf8');
  const compatibilityScriptIndex = popupHtml.indexOf('src/shared/compatibility.js');
  const popupScriptIndex = popupHtml.indexOf('src/popup.js');

  assert.match(popupHtml, /id="native-install"/);
  assert.match(popupHtml, /id="install-command"/);
  assert.match(popupHtml, /id="copy-install-command"/);
  assert.ok(compatibilityScriptIndex > -1);
  assert.ok(compatibilityScriptIndex < popupScriptIndex);
  assert.match(popupJs, /const INSTALL_COMMAND/);
  assert.match(popupJs, /bridge\.ping/);
  assert.match(popupJs, /codex-overleaf\/native-request/);
  assert.match(popupJs, /navigator\.clipboard\.writeText\(INSTALL_COMMAND\)/);
  assert.match(popupJs, /showNativeInstallGuide/);
});

test('panel native diagnostics show the same copyable installer guidance when native host is missing', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );

  assert.match(contentScript, /const INSTALL_COMMAND/);
  assert.match(contentScript, /renderInstallCommand/);
  assert.match(contentScript, /navigator\.clipboard\.writeText\(command\)/);
  assert.match(contentScript, /installCommand:\s*INSTALL_COMMAND/);
  assert.match(css, /\.codex-install-command/);
});
