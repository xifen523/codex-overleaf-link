const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { DEFAULT_CHROME_EXTENSION_ID } = require('../native-host/src/manifest');

test('native install script defaults to the committed extension id', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../scripts/install-native-host.mjs'),
    'utf8'
  );

  assert.match(source, /DEFAULT_CHROME_EXTENSION_ID/);
  assert.match(source, /args\.extensionId \|\| DEFAULT_CHROME_EXTENSION_ID/);
  assert.equal(DEFAULT_CHROME_EXTENSION_ID, 'illdpneeeopfffmiepaejglgmhpmdhdc');
});

test('repository does not ship a generated native bridge with local absolute paths', () => {
  assert.equal(
    fs.existsSync(path.join(__dirname, '../native-host/bin/codex-overleaf-bridge')),
    false
  );
});

test('package exposes install and uninstall native host commands', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));

  assert.equal(pkg.scripts['install:native'], 'node scripts/install-native-host.mjs');
  assert.equal(pkg.scripts['uninstall:native'], 'node scripts/uninstall-native-host.mjs');
});
