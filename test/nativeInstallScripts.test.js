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

test('native install runtime includes package metadata required by bridge ping', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-runtime-test-'));
  const runtimeRoot = path.join(tempDir, 'runtime');
  const bridgePath = path.join(tempDir, 'codex-overleaf-bridge');
  try {
    const result = spawnSync(process.execPath, [
      path.join(__dirname, '../scripts/install-native-host.mjs'),
      '--runtime-root',
      runtimeRoot,
      '--bridge-path',
      bridgePath
    ], {
      env: {
        ...process.env,
        HOME: tempDir
      },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const runtimePackagePath = path.join(runtimeRoot, 'package.json');
    assert.equal(fs.existsSync(runtimePackagePath), true);
    const runtimePackage = JSON.parse(fs.readFileSync(runtimePackagePath, 'utf8'));
    const { handleRequest } = require(path.join(runtimeRoot, 'native-host/src/taskRunner.js'));
    const response = await handleRequest({ id: 'runtime-ping', method: 'bridge.ping', params: {} }, {});

    assert.equal(response.ok, true);
    assert.equal(response.result.version, runtimePackage.version);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('repository ships a one-command macOS installer', () => {
  const installer = fs.readFileSync(path.join(__dirname, '../install.sh'), 'utf8');
  const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');

  assert.match(installer, /CODEX_OVERLEAF_INSTALL_DIR/);
  assert.match(installer, /github\.com\/Ghqqqq\/codex-overleaf-link\.git/);
  assert.match(installer, /scripts\/install-native-host\.mjs/);
  assert.match(installer, /chrome:\/\/extensions/);
  assert.match(installer, /extension/);
  assert.match(installer, /CODEX_OVERLEAF_EXTENSION_LINK/);
  assert.match(installer, /Codex Overleaf Link Extension/);
  assert.match(installer, /ln -s/);
  assert.match(installer, /pbcopy/);
  assert.match(installer, /open -a "Google Chrome" "chrome:\/\/extensions"/);
  assert.match(installer, /open -R/);
  assert.match(readme, /curl -fsSL "https:\/\/raw\.githubusercontent\.com\/Ghqqqq\/codex-overleaf-link\/main\/install\.sh\?\$\(date \+%s\)" \| bash/);
  assert.match(readme, /~\/Codex Overleaf Link Extension/);
  assert.doesNotMatch(readme, /select `~\/\.codex-overleaf\/source\/extension`/);
});

test('one-command installer works on macOS Bash 3.2 when extension id is unset', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-install-test-'));
  const binDir = path.join(tempDir, 'bin');
  const installDir = path.join(tempDir, 'source');
  const visibleExtensionLink = path.join(tempDir, 'Codex Overleaf Link Extension');
  const nodeLog = path.join(tempDir, 'node-args.json');
  const openLog = path.join(tempDir, 'open-args.txt');
  const pbcopyLog = path.join(tempDir, 'pbcopy.txt');
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
  fs.writeFileSync(path.join(binDir, 'open'), [
    '#!/bin/bash',
    `for arg in "$@"; do printf '%s\\n' "$arg"; done >> "${openLog}"`,
    'exit 0'
  ].join('\n'));
  fs.writeFileSync(path.join(binDir, 'pbcopy'), [
    '#!/bin/bash',
    `cat > "${pbcopyLog}"`,
    'exit 0'
  ].join('\n'));
  fs.chmodSync(path.join(binDir, 'git'), 0o755);
  fs.chmodSync(path.join(binDir, 'node'), 0o755);
  fs.chmodSync(path.join(binDir, 'open'), 0o755);
  fs.chmodSync(path.join(binDir, 'pbcopy'), 0o755);

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
  assert.equal(fs.readlinkSync(visibleExtensionLink), path.join(installDir, 'extension'));
  assert.equal(fs.readFileSync(pbcopyLog, 'utf8'), visibleExtensionLink);
  const openArgs = fs.readFileSync(openLog, 'utf8');
  assert.match(openArgs, /-a\nGoogle Chrome\nchrome:\/\/extensions/);
  assert.match(openArgs, /-R/);
  assert.match(openArgs, /Codex Overleaf Link Extension/);
});
