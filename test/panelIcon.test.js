const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('empty run state uses the custom Codex Overleaf icon instead of a text glyph', () => {
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
  assert.match(css, /\.codex-empty-icon::before/);
  assert.match(css, /\.codex-empty-icon::after/);
});
