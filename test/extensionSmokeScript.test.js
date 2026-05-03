const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('package exposes a real Chrome extension smoke-test entrypoint', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  assert.equal(pkg.scripts['smoke:extension'], 'node scripts/smoke-extension.mjs');
});

test('extension smoke script loads the unpacked extension and probes the Overleaf panel', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../scripts/smoke-extension.mjs'),
    'utf8'
  );

  assert.match(source, /--load-extension=/);
  assert.match(source, /--disable-extensions-except=/);
  assert.match(source, /--remote-debugging-port=/);
  assert.match(source, /Runtime\.evaluate/);
  assert.match(source, /codex-overleaf-panel/);
  assert.match(source, /--url/);
});
