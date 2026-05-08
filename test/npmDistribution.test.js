const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const packageJson = require('../package.json');
const cliPath = path.join(repoRoot, 'bin/codex-overleaf-link.mjs');

function runCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
}

test('package metadata is configured for npm distribution', () => {
  assert.equal(packageJson.name, 'codex-overleaf-link');
  assert.equal(packageJson.version, '1.1.0');
  assert.equal(packageJson.bin['codex-overleaf-link'], 'bin/codex-overleaf-link.mjs');
  assert.match(packageJson.packageManager, /^npm@/);
  assert.ok(packageJson.files.includes('bin/'));
});

test('version command prints the package version', () => {
  const result = runCli(['version']);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.trim(), '1.1.0');
});

test('version command supports json output', () => {
  const result = runCli(['version', '--json']);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), { packageVersion: '1.1.0' });
});

test('help command lists available commands', () => {
  const result = runCli(['help']);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /Commands:/);
  assert.match(result.stdout, /install-native/);
  assert.match(result.stdout, /uninstall-native/);
  assert.match(result.stdout, /doctor/);
  assert.match(result.stdout, /version/);
  assert.match(result.stdout, /help/);
});

test('unknown command exits with an error', () => {
  const result = runCli(['missing-command']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown command/);
});

test('install-native command is not implemented yet', () => {
  const result = runCli(['install-native']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /install-native is not implemented yet\./);
});
