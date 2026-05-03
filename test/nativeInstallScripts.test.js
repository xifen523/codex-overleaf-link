const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
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

test('repository ships a one-command macOS installer', () => {
  const installer = fs.readFileSync(path.join(__dirname, '../install.sh'), 'utf8');
  const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');

  assert.match(installer, /CODEX_OVERLEAF_INSTALL_DIR/);
  assert.match(installer, /github\.com\/Ghqqqq\/codex-overleaf-link\.git/);
  assert.match(installer, /scripts\/install-native-host\.mjs/);
  assert.match(installer, /chrome:\/\/extensions/);
  assert.match(installer, /extension/);
  assert.match(readme, /curl -fsSL "https:\/\/raw\.githubusercontent\.com\/Ghqqqq\/codex-overleaf-link\/main\/install\.sh\?\$\(date \+%s\)" \| bash/);
  assert.match(readme, /~\/\.codex-overleaf\/source\/extension/);
});

test('one-command installer works on macOS Bash 3.2 when extension id is unset', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-install-test-'));
  const binDir = path.join(tempDir, 'bin');
  const installDir = path.join(tempDir, 'source');
  const nodeLog = path.join(tempDir, 'node-args.json');
  fs.mkdirSync(binDir, { recursive: true });

  fs.writeFileSync(path.join(binDir, 'git'), [
    '#!/bin/bash',
    'if [ "$1" = "clone" ]; then',
    '  target=""',
    '  for arg in "$@"; do target="$arg"; done',
    '  mkdir -p "$target/.git"',
    '  exit 0',
    'fi',
    'exit 0'
  ].join('\n'));
  fs.writeFileSync(path.join(binDir, 'node'), [
    '#!/bin/bash',
    `for arg in "$@"; do printf '%s\\n' "$arg"; done > "${nodeLog}"`,
    'exit 0'
  ].join('\n'));
  fs.writeFileSync(path.join(binDir, 'open'), '#!/bin/sh\nexit 0\n');
  fs.chmodSync(path.join(binDir, 'git'), 0o755);
  fs.chmodSync(path.join(binDir, 'node'), 0o755);
  fs.chmodSync(path.join(binDir, 'open'), 0o755);

  const result = spawnSync('/bin/bash', [path.join(__dirname, '../install.sh')], {
    env: {
      HOME: tempDir,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      CODEX_OVERLEAF_REPO_URL: 'https://example.invalid/repo.git',
      CODEX_OVERLEAF_INSTALL_DIR: installDir
    },
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const nodeArgs = fs.readFileSync(nodeLog, 'utf8');
  assert.match(nodeArgs, /scripts\/install-native-host\.mjs/);
  assert.doesNotMatch(nodeArgs, /--extension-id/);
});
