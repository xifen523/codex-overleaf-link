const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
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
  assert.equal(result.stdout.trim(), packageJson.version);
});

test('version command supports json output', () => {
  const result = runCli(['version', '--json']);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), { packageVersion: packageJson.version });
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


test('npm package verifier rejects forbidden package paths and allows runtime paths', async () => {
  const moduleUrl = pathToFileURL(path.join(repoRoot, 'scripts/verify-npm-package.mjs')).href;
  const { findForbiddenNpmPackagePaths } = await import(moduleUrl);

  const forbiddenPaths = [
    'package/docs/guide.md',
    'package/specs/api.md',
    'package/superpowers/internal.md',
    'package/private/token.txt',
    'package/test/npmDistribution.test.js',
    'package/tests/fixture.test.js',
    'package/fixtures/sample.json',
    'package/dist/bundle.js',
    'package/.github/workflows/release.yml',
    'package/node_modules/dependency/index.js',
    'package/config/.env',
    'package/config/.env.local',
    'package/config/.env.production',
    'package/certificates/dev.pem',
    'package/certificates/dev.key',
    'package/certificates/profile.p12'
  ];
  const allowedPaths = [
    'package/native-host/src/index.js',
    'package/extension/src/shared/compatibility.js'
  ];

  assert.deepEqual(findForbiddenNpmPackagePaths([...forbiddenPaths, ...allowedPaths]), [...forbiddenPaths].sort());
});

test('npm package exact manifest checker reports missing and extra files', async () => {
  const moduleUrl = pathToFileURL(path.join(repoRoot, 'scripts/verify-npm-package.mjs')).href;
  const { compareExactManifest, verifyPackagePaths } = await import(moduleUrl);
  const expected = [
    'package/package.json',
    'package/native-host/src/index.js',
    'package/extension/src/shared/compatibility.js'
  ];
  const actual = [
    'package/package.json',
    'package/extension/src/shared/compatibility.js',
    'package/bin/extra.mjs'
  ];

  assert.deepEqual(compareExactManifest(actual, expected), {
    missing: ['package/native-host/src/index.js'],
    extra: ['package/bin/extra.mjs']
  });

  const result = verifyPackagePaths(actual, expected);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['package/native-host/src/index.js']);
  assert.deepEqual(result.extra, ['package/bin/extra.mjs']);
});

test('npm package verifier CLI checks actual package contents by default', () => {
  const result = spawnSync(process.execPath, [
    path.join(repoRoot, 'scripts/verify-npm-package.mjs')
  ], {
    cwd: repoRoot,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Verified npm package manifest/);
  assert.equal(result.stderr, '');
});

test('npm package verifier CLI checks newline file lists', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-npm-package-'));
  try {
    const fileListPath = path.join(tempDir, 'files.txt');
    fs.writeFileSync(fileListPath, fs.readFileSync(path.join(repoRoot, 'scripts/npm-package-files-v1.1.0.txt'), 'utf8'));

    const result = spawnSync(process.execPath, [
      path.join(repoRoot, 'scripts/verify-npm-package.mjs'),
      '--file-list',
      fileListPath
    ], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Verified npm package manifest/);
    assert.equal(result.stderr, '');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});


test('npm package verifier rejects removed tarball mode with usage', () => {
  const result = spawnSync(process.execPath, [
    path.join(repoRoot, 'scripts/verify-npm-package.mjs'),
    '--tarball',
    path.join(os.tmpdir(), 'not-current-package.tgz')
  ], {
    cwd: repoRoot,
    encoding: 'utf8'
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage:/);
  assert.doesNotMatch(result.stderr, /--tarball/);
  assert.equal(result.stdout, '');
});
