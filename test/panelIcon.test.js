const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('empty run state uses the custom Codex Overleaf image asset instead of a text glyph', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );

  assert.equal(contentScript.includes('✳'), false);
  assert.match(contentScript, /codex-empty-icon/);
  assert.match(contentScript, /chrome\.runtime\.getURL\('assets\/icons\/codex-overleaf-icon\.png'\)/);
  assert.match(css, /\.codex-empty-icon\s*\{[\s\S]*width:\s*108px/);
  assert.match(css, /\.codex-empty-icon\s*\{[\s\S]*height:\s*108px/);
  assert.match(css, /\.codex-empty-icon\s*\{[\s\S]*object-fit:\s*contain/);
  assert.doesNotMatch(css, /\.codex-empty-icon::before/);
  assert.doesNotMatch(css, /\.codex-empty-icon::after/);
});

test('extension manifest exposes the Codex Overleaf icon for Chrome and the panel', () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../extension/manifest.json'),
    'utf8'
  ));
  const sourceIcon = fs.readFileSync(
    path.join(__dirname, '../extension/assets/icons/codex-overleaf-icon.png')
  );

  assert.equal(manifest.icons['128'], 'assets/icons/icon128.png');
  assert.equal(manifest.action.default_icon['32'], 'assets/icons/icon32.png');
  assert.equal(
    manifest.web_accessible_resources[0].resources.includes('assets/icons/codex-overleaf-icon.png'),
    true
  );
  assert.equal(sourceIcon[25], 6);
  assert.equal(fs.existsSync(path.join(__dirname, '../extension/assets/icons/codex-overleaf-icon.svg')), false);
});
