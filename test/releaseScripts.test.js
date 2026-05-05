const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function readReleaseWorkflow() {
  return readText(path.join(repoRoot, '.github/workflows/release.yml'));
}

function getTopLevelYamlSection(text, sectionName) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `${sectionName}:`);
  assert.notEqual(start, -1, `Missing top-level ${sectionName}: section`);

  const body = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() && /^\S/.test(line)) {
      break;
    }
    body.push(line);
  }
  return body.join('\n');
}

function assertContainsInOrder(text, expectedFragments) {
  let searchFrom = 0;
  for (const fragment of expectedFragments) {
    const index = text.indexOf(fragment, searchFrom);
    assert.notEqual(index, -1, `Expected workflow to contain ${fragment} after offset ${searchFrom}`);
    searchFrom = index + fragment.length;
  }
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function listTarEntries(filePath) {
  const result = spawnSync('tar', ['-tzf', filePath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map((entry) => entry.replace(/^\.\//, ''));
}

function listZipEntries(filePath, t) {
  const result = spawnSync('unzip', ['-Z1', filePath], { encoding: 'utf8' });
  if (result.error && result.error.code === 'ENOENT') {
    t.skip('unzip is required to inspect release zip contents');
    return [];
  }
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.split('\n').filter(Boolean);
}

function writeReleaseFixture(rootDir, overrides = {}) {
  const packageVersion = overrides.packageVersion || '1.2.3';
  const manifestVersion = overrides.manifestVersion || packageVersion;
  const readmeVersion = overrides.readmeVersion || packageVersion;
  const changelogVersion = overrides.changelogVersion || packageVersion;
  const changelogDate = overrides.changelogDate || '2026-05-06';
  const changelogBody = Object.hasOwn(overrides, 'changelogBody')
    ? overrides.changelogBody
    : 'Fixture release notes.\n';

  fs.mkdirSync(path.join(rootDir, 'extension'), { recursive: true });
  fs.writeFileSync(
    path.join(rootDir, 'package.json'),
    `${JSON.stringify({ version: packageVersion }, null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(rootDir, 'extension/manifest.json'),
    `${JSON.stringify({ version: manifestVersion }, null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(rootDir, 'README.md'),
    `<img src="https://img.shields.io/badge/version-${readmeVersion}-blue" alt="version">\n`
  );
  fs.writeFileSync(
    path.join(rootDir, 'CHANGELOG.md'),
    overrides.changelogText || `# Changelog\n\n## v${changelogVersion} - ${changelogDate}\n\n${changelogBody}`
  );
}

function writeChromeWebStoreDocs(rootDir) {
  const docsDir = path.join(rootDir, 'docs/chrome-web-store');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, 'permissions.md'), 'nativeMessaging\nstorage\nhttps://www.overleaf.com/project/*\nhttps://overleaf.com/project/*\nno broad host permissions\n');
  fs.writeFileSync(path.join(docsDir, 'privacy.md'), 'no hosted backend\n~/.codex-overleaf/projects\n~/.codex-overleaf/codex-home\nCodex CLI account\nno default telemetry\ndiagnostics exclude project content\n');
  fs.writeFileSync(path.join(docsDir, 'listing.md'), 'Short description\nDetailed description\nFeature bullets\nSupport\n128 icon\nscreenshots\nsmall promo image\noptional marquee image\n');
  fs.writeFileSync(path.join(docsDir, 'release-checklist.md'), 'npm test\nnpm run verify:release\nnpm run build:release\nverify checksums\ninspect extension zip\nWeb Store extension id\noutside v0.4\n');
}

test('package exposes release verification and artifact build commands', () => {
  const pkg = readJson(path.join(repoRoot, 'package.json'));

  assert.equal(pkg.scripts['verify:release'], 'node scripts/verify-release.mjs');
  assert.equal(pkg.scripts['build:release'], 'node scripts/build-release.mjs');
});

test('release workflow only publishes semver-like version tags', () => {
  const workflow = readReleaseWorkflow();
  const triggerSection = getTopLevelYamlSection(workflow, 'on');

  assert.match(triggerSection, /^\s+push:\s*$/m);
  assert.match(triggerSection, /^\s+tags:\s*$/m);
  assert.match(triggerSection, /^\s+- "v\*\.\*\.\*"\s*$/m);
  assert.doesNotMatch(triggerSection, /^\s+branches:/m);
  assert.doesNotMatch(triggerSection, /^\s+pull_request:/m);
  assert.doesNotMatch(triggerSection, /^\s+workflow_dispatch:/m);
  assert.doesNotMatch(triggerSection, /^\s+schedule:/m);
});

test('release workflow grants publish permission and runs release checks before building', () => {
  const workflow = readReleaseWorkflow();
  const permissionsSection = getTopLevelYamlSection(workflow, 'permissions');

  assert.match(permissionsSection, /^\s+contents:\s+write\s*$/m);
  assertContainsInOrder(workflow, [
    'run: npm test',
    'run: npm run verify:release',
    'run: npm run build:release',
    'uses: softprops/action-gh-release@v2'
  ]);
});

test('release workflow publishes generated notes and built artifacts', () => {
  const workflow = readReleaseWorkflow();

  assert.match(workflow, /uses:\s+softprops\/action-gh-release@v2/);
  assert.match(workflow, /^\s+draft:\s+false\s*$/m);
  assert.match(workflow, /^\s+prerelease:\s+false\s*$/m);
  assert.match(workflow, /^\s+name:\s+\$\{\{ github\.ref_name \}\}\s*$/m);
  assert.match(
    workflow,
    /^\s+body_path:\s+dist\/releases\/\$\{\{ github\.ref_name \}\}\/release-notes\.md\s*$/m
  );
  assert.match(
    workflow,
    /^\s+files:\s+dist\/releases\/\$\{\{ github\.ref_name \}\}\/\*\s*$/m
  );
  assert.match(workflow, /^\s+fail_on_unmatched_files:\s+true\s*$/m);
  assert.match(workflow, /^\s+overwrite_files:\s+true\s*$/m);
});

test('release verifier catches package and extension manifest version mismatch', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-release-verify-'));
  try {
    writeReleaseFixture(tempDir, {
      packageVersion: '1.2.3',
      manifestVersion: '1.2.4'
    });
    const moduleUrl = pathToFileURL(path.join(repoRoot, 'scripts/verify-release.mjs')).href;
    const { collectReleaseVerificationErrors } = await import(moduleUrl);

    const errors = collectReleaseVerificationErrors({
      rootDir: tempDir,
      releaseDate: '2026-05-06'
    });

    assert.ok(
      errors.some((error) => /manifest\.json version .*1\.2\.4.*package\.json version .*1\.2\.3/i.test(error)),
      errors.join('\n')
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('release verifier catches README badge mismatch', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-release-readme-'));
  try {
    writeReleaseFixture(tempDir, {
      packageVersion: '1.2.3',
      readmeVersion: '1.2.4'
    });
    const moduleUrl = pathToFileURL(path.join(repoRoot, 'scripts/verify-release.mjs')).href;
    const { collectReleaseVerificationErrors } = await import(moduleUrl);

    const errors = collectReleaseVerificationErrors({
      rootDir: tempDir,
      releaseDate: '2026-05-06'
    });

    assert.ok(
      errors.some((error) => /README\.md.*version-1\.2\.3-blue/i.test(error)),
      errors.join('\n')
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('release verifier catches CHANGELOG heading date mismatch', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-release-changelog-'));
  try {
    writeReleaseFixture(tempDir, {
      packageVersion: '1.2.3',
      changelogDate: '2026-05-07'
    });
    const moduleUrl = pathToFileURL(path.join(repoRoot, 'scripts/verify-release.mjs')).href;
    const { collectReleaseVerificationErrors } = await import(moduleUrl);

    const errors = collectReleaseVerificationErrors({
      rootDir: tempDir,
      releaseDate: '2026-05-06'
    });

    assert.ok(
      errors.some((error) => /CHANGELOG\.md.*## v1\.2\.3 - 2026-05-06/i.test(error)),
      errors.join('\n')
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('release verifier requires Chrome Web Store prep docs for v0.4 releases', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-release-docs-'));
  try {
    writeReleaseFixture(tempDir, {
      packageVersion: '0.4.0'
    });
    const moduleUrl = pathToFileURL(path.join(repoRoot, 'scripts/verify-release.mjs')).href;
    const { collectReleaseVerificationErrors } = await import(moduleUrl);

    const missingDocErrors = collectReleaseVerificationErrors({
      rootDir: tempDir,
      releaseDate: '2026-05-06'
    });
    assert.ok(
      missingDocErrors.some((error) => /docs\/chrome-web-store\/permissions\.md/.test(error)),
      missingDocErrors.join('\n')
    );
    assert.ok(
      missingDocErrors.some((error) => /docs\/chrome-web-store\/privacy\.md/.test(error)),
      missingDocErrors.join('\n')
    );
    assert.ok(
      missingDocErrors.some((error) => /docs\/chrome-web-store\/listing\.md/.test(error)),
      missingDocErrors.join('\n')
    );
    assert.ok(
      missingDocErrors.some((error) => /docs\/chrome-web-store\/release-checklist\.md/.test(error)),
      missingDocErrors.join('\n')
    );

    writeChromeWebStoreDocs(tempDir);
    assert.deepEqual(collectReleaseVerificationErrors({ rootDir: tempDir, releaseDate: '2026-05-06' }), []);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Chrome Web Store prep docs describe current permissions and privacy posture', () => {
  const docsDir = path.join(repoRoot, 'docs/chrome-web-store');
  const permissions = readText(path.join(docsDir, 'permissions.md'));
  const privacy = readText(path.join(docsDir, 'privacy.md'));
  const listing = readText(path.join(docsDir, 'listing.md'));
  const checklist = readText(path.join(docsDir, 'release-checklist.md'));

  assert.match(permissions, /nativeMessaging/);
  assert.match(permissions, /local native bridge/i);
  assert.match(permissions, /storage/);
  assert.match(permissions, /local extension preferences/i);
  assert.match(permissions, /https:\/\/www\.overleaf\.com\/project\/\*/);
  assert.match(permissions, /https:\/\/overleaf\.com\/project\/\*/);
  assert.match(permissions, /no broad host permissions/i);

  assert.match(privacy, /no hosted backend/i);
  assert.match(privacy, /~\/\.codex-overleaf\/projects/);
  assert.match(privacy, /~\/\.codex-overleaf\/codex-home/);
  assert.match(privacy, /Codex CLI account/i);
  assert.match(privacy, /no default telemetry/i);
  assert.match(privacy, /diagnostics exclude project content/i);

  assert.match(listing, /short description/i);
  assert.match(listing, /detailed description/i);
  assert.match(listing, /feature bullets/i);
  assert.match(listing, /support/i);
  assert.match(listing, /128 icon/i);
  assert.match(listing, /screenshots/i);
  assert.match(listing, /small promo image/i);
  assert.match(listing, /optional marquee image/i);

  assert.match(checklist, /npm test/);
  assert.match(checklist, /npm run verify:release/);
  assert.match(checklist, /npm run build:release/);
  assert.match(checklist, /verify checksums/i);
  assert.match(checklist, /inspect extension zip/i);
  assert.match(checklist, /Web Store extension id/i);
  assert.match(checklist, /outside v0\.4/i);
});

test('release verifier CLI exits 1 on metadata mismatch', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-release-cli-'));
  try {
    writeReleaseFixture(tempDir, {
      packageVersion: '1.2.3',
      manifestVersion: '1.2.4'
    });

    const result = spawnSync(process.execPath, [
      path.join(repoRoot, 'scripts/verify-release.mjs'),
      '--root',
      tempDir
    ], {
      encoding: 'utf8'
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Release verification failed/);
    assert.match(result.stderr, /extension\/manifest\.json version 1\.2\.4/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('build-release derives the default output directory from version', async () => {
  const moduleUrl = pathToFileURL(path.join(repoRoot, 'scripts/build-release.mjs')).href;
  const { getDefaultReleaseOutputDir } = await import(moduleUrl);

  assert.equal(
    getDefaultReleaseOutputDir({ rootDir: '/tmp/codex-overleaf-link', version: '1.2.3' }),
    path.join('/tmp/codex-overleaf-link', 'dist/releases/v1.2.3')
  );
});

test('build-release rejects unsafe output paths before deletion', async () => {
  const moduleUrl = pathToFileURL(path.join(repoRoot, 'scripts/build-release.mjs')).href;
  const { assertSafeReleaseOutputDir } = await import(moduleUrl);
  const unsafePaths = [
    repoRoot,
    path.dirname(repoRoot),
    path.parse(repoRoot).root,
    os.homedir()
  ];

  for (const outputDir of unsafePaths) {
    assert.throws(
      () => assertSafeReleaseOutputDir({ rootDir: repoRoot, outputDir }),
      /Refusing to use unsafe release output directory/
    );
  }

  assert.doesNotThrow(() => assertSafeReleaseOutputDir({
    rootDir: repoRoot,
    outputDir: path.join(os.tmpdir(), `codex-overleaf-fresh-output-${process.pid}`)
  }));
});

test('build-release refuses unmarked non-empty custom output directories without deleting them', async () => {
  const moduleUrl = pathToFileURL(path.join(repoRoot, 'scripts/build-release.mjs')).href;
  const { buildRelease } = await import(moduleUrl);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-release-unsafe-output-'));
  const outputDir = path.join(tempDir, 'existing-output');
  const sentinelPath = path.join(outputDir, 'keep.txt');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(sentinelPath, 'keep this file\n');

  try {
    let error;
    try {
      buildRelease({ rootDir: repoRoot, outputDir });
    } catch (caught) {
      error = caught;
    }

    assert.match(error && error.message, /non-empty release output directory/);
    assert.equal(fs.readFileSync(sentinelPath, 'utf8'), 'keep this file\n');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('build-release argument parser rejects missing values and unknown flags', async () => {
  const moduleUrl = pathToFileURL(path.join(repoRoot, 'scripts/build-release.mjs')).href;
  const { parseBuildReleaseArgs } = await import(moduleUrl);

  assert.throws(() => parseBuildReleaseArgs(['--output']), /--output requires a path value/);
  assert.throws(() => parseBuildReleaseArgs(['--output', '--unknown']), /--output requires a path value/);
  assert.throws(() => parseBuildReleaseArgs(['--unknown']), /Unknown option: --unknown/);
});

test('build-release CLI exits non-zero on unknown flags before building', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-release-bad-args-'));
  const outputDir = path.join(tempDir, 'out');
  try {
    const result = spawnSync(process.execPath, [
      path.join(repoRoot, 'scripts/build-release.mjs'),
      '--output',
      outputDir,
      '--unknown'
    ], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unknown option: --unknown/);
    assert.match(result.stderr, /Usage: node scripts\/build-release\.mjs/);
    assert.equal(fs.existsSync(outputDir), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('release note extraction fails for missing or empty changelog sections', async () => {
  const moduleUrl = pathToFileURL(path.join(repoRoot, 'scripts/build-release.mjs')).href;
  const { extractReleaseNotes } = await import(moduleUrl);

  assert.throws(
    () => extractReleaseNotes('# Changelog\n\n## v1.2.2 - 2026-05-05\n\nPrevious notes.\n', '1.2.3'),
    /does not contain a release section for v1\.2\.3/
  );
  assert.throws(
    () => extractReleaseNotes('# Changelog\n\n## v1.2.3 - 2026-05-06\n\n## v1.2.2 - 2026-05-05\n\nPrevious notes.\n', '1.2.3'),
    /release section for v1\.2\.3 is empty/
  );
});

test('top-level copied uninstaller runs from release artifact root', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-release-uninstall-'));
  const outputDir = path.join(tempDir, 'out');
  const homeDir = path.join(tempDir, 'home');
  const runtimeRoot = path.join(tempDir, 'runtime');
  const bridgePath = path.join(tempDir, 'codex-overleaf-bridge');

  try {
    const build = spawnSync(process.execPath, [
      path.join(repoRoot, 'scripts/build-release.mjs'),
      '--output',
      outputDir
    ], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    if (build.status !== 0 && /required command "zip"|zip is required/i.test(build.stderr)) {
      t.skip('zip is required to build release artifacts');
      return;
    }
    assert.equal(build.status, 0, build.stderr || build.stdout);

    fs.mkdirSync(path.dirname(bridgePath), { recursive: true });
    fs.writeFileSync(bridgePath, '#!/bin/sh\n');
    fs.mkdirSync(runtimeRoot, { recursive: true });

    const result = spawnSync(process.execPath, [
      path.join(outputDir, 'uninstall-native-host.mjs'),
      '--runtime-root',
      runtimeRoot,
      '--bridge-path',
      bridgePath,
      '--keep-runtime'
    ], {
      env: {
        ...process.env,
        HOME: homeDir
      },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.existsSync(bridgePath), false);
    assert.equal(fs.existsSync(runtimeRoot), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('release archives exclude untracked files under packaged directories', (t) => {
  const pkg = readJson(path.join(repoRoot, 'package.json'));
  const version = pkg.version;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-release-untracked-'));
  const outputDir = path.join(tempDir, 'out');
  const uniqueName = `codex-overleaf-untracked-${process.pid}-${Date.now()}.js`;
  const extensionUntracked = path.join(repoRoot, 'extension/src/shared', uniqueName);
  const nativeUntracked = path.join(repoRoot, 'native-host/src', uniqueName);
  const assetUntrackedName = uniqueName.replace(/\.js$/, '.txt');
  const assetUntracked = path.join(repoRoot, 'extension/assets', assetUntrackedName);

  try {
    fs.writeFileSync(extensionUntracked, 'window.__codexOverleafUntracked = true;\n');
    fs.writeFileSync(nativeUntracked, 'module.exports = true;\n');
    fs.writeFileSync(assetUntracked, 'untracked asset\n');

    const result = spawnSync(process.execPath, [
      path.join(repoRoot, 'scripts/build-release.mjs'),
      '--output',
      outputDir
    ], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    if (result.status !== 0 && /required command "zip"|zip is required/i.test(result.stderr)) {
      t.skip('zip is required to build release artifacts');
      return;
    }
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const zipEntries = listZipEntries(path.join(outputDir, `codex-overleaf-link-extension-v${version}.zip`), t);
    assert.equal(zipEntries.includes(`src/shared/${uniqueName}`), false);
    assert.equal(zipEntries.includes(`assets/${assetUntrackedName}`), false);

    const tarEntries = listTarEntries(path.join(outputDir, `codex-overleaf-native-host-v${version}.tar.gz`));
    assert.equal(tarEntries.includes(`extension/src/shared/${uniqueName}`), false);
    assert.equal(tarEntries.includes(`native-host/src/${uniqueName}`), false);
  } finally {
    fs.rmSync(extensionUntracked, { force: true });
    fs.rmSync(nativeUntracked, { force: true });
    fs.rmSync(assetUntracked, { force: true });
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('build-release refuses dirty tracked packaged files before writing artifacts', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-release-dirty-tracked-'));
  const outputDir = path.join(tempDir, 'out');
  const trackedFile = path.join(repoRoot, 'extension/src/shared/summary.js');
  const originalContent = fs.readFileSync(trackedFile);

  try {
    fs.writeFileSync(
      trackedFile,
      Buffer.concat([originalContent, Buffer.from('\n// codex-overleaf dirty release test\n')])
    );

    const result = spawnSync(process.execPath, [
      path.join(repoRoot, 'scripts/build-release.mjs'),
      '--output',
      outputDir
    ], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /tracked release input files have uncommitted changes/i);
    assert.match(result.stderr, /commit or stash/i);
    assert.match(result.stderr, /extension\/src\/shared\/summary\.js/);
    assert.equal(fs.existsSync(path.join(outputDir, 'release-manifest.json')), false);
    assert.equal(fs.existsSync(path.join(outputDir, `codex-overleaf-link-extension-v${readJson(path.join(repoRoot, 'package.json')).version}.zip`)), false);
  } finally {
    fs.writeFileSync(trackedFile, originalContent);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('build-release refuses packaged files staged for deletion from HEAD', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-release-staged-delete-'));
  const outputDir = path.join(tempDir, 'out');
  const relativePath = 'extension/src/shared/summary.js';
  const trackedFile = path.join(repoRoot, relativePath);
  const originalContent = fs.readFileSync(trackedFile);

  try {
    const removeResult = spawnSync('git', ['rm', '--cached', relativePath], {
      cwd: repoRoot,
      encoding: 'utf8'
    });
    assert.equal(removeResult.status, 0, removeResult.stderr || removeResult.stdout);
    assert.equal(fs.existsSync(trackedFile), true);

    const result = spawnSync(process.execPath, [
      path.join(repoRoot, 'scripts/build-release.mjs'),
      '--output',
      outputDir
    ], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /tracked release input files have uncommitted changes/i);
    assert.match(result.stderr, /commit or stash/i);
    assert.match(result.stderr, /extension\/src\/shared\/summary\.js/);
    assert.equal(fs.existsSync(path.join(outputDir, 'release-manifest.json')), false);
    assert.equal(fs.existsSync(path.join(outputDir, `codex-overleaf-link-extension-v${readJson(path.join(repoRoot, 'package.json')).version}.zip`)), false);
  } finally {
    fs.writeFileSync(trackedFile, originalContent);
    spawnSync('git', ['restore', '--staged', '--', relativePath], {
      cwd: repoRoot,
      encoding: 'utf8'
    });
    fs.writeFileSync(trackedFile, originalContent);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('build-release creates expected artifacts and metadata', (t) => {
  const pkg = readJson(path.join(repoRoot, 'package.json'));
  const version = pkg.version;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-release-build-'));
  const outputDir = path.join(tempDir, 'out');
  const extensionZip = `codex-overleaf-link-extension-v${version}.zip`;
  const nativeTarball = `codex-overleaf-native-host-v${version}.tar.gz`;

  try {
    const result = spawnSync(process.execPath, [
      path.join(repoRoot, 'scripts/build-release.mjs'),
      '--output',
      outputDir
    ], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    if (result.status !== 0 && /required command "zip"|zip is required/i.test(result.stderr)) {
      t.skip('zip is required to build release artifacts');
      return;
    }
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const expectedFiles = [
      extensionZip,
      nativeTarball,
      'install.sh',
      'uninstall-native-host.mjs',
      'release-manifest.json',
      'release-notes.md',
      'SHA256SUMS'
    ];
    for (const fileName of expectedFiles) {
      assert.equal(fs.existsSync(path.join(outputDir, fileName)), true, `${fileName} was not generated`);
    }

    const manifest = readJson(path.join(outputDir, 'release-manifest.json'));
    assert.equal(manifest.version, version);
    assert.match(manifest.gitCommit, /^(unknown|[0-9a-f]{40})$/);
    assert.doesNotThrow(() => new Date(manifest.createdAt).toISOString());
    assert.deepEqual(
      manifest.artifacts.map((artifact) => artifact.name).sort(),
      [extensionZip, nativeTarball, 'install.sh', 'uninstall-native-host.mjs'].sort()
    );
    for (const artifact of manifest.artifacts) {
      const artifactPath = path.join(outputDir, artifact.name);
      assert.equal(artifact.size, fs.statSync(artifactPath).size);
      assert.equal(artifact.sha256, sha256(artifactPath));
      assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
    }

    const releaseNotes = fs.readFileSync(path.join(outputDir, 'release-notes.md'), 'utf8');
    assert.match(releaseNotes, new RegExp(`^## v${version.replace(/\./g, '\\.')} - `));
    assert.doesNotMatch(releaseNotes, /\n## v0\.2\.0 - /);

    const sums = fs.readFileSync(path.join(outputDir, 'SHA256SUMS'), 'utf8').trim().split('\n');
    const checksumNames = sums.map((line) => line.replace(/^[0-9a-f]{64}\s+\*?/, ''));
    assert.deepEqual(
      checksumNames.sort(),
      [extensionZip, nativeTarball, 'install.sh', 'uninstall-native-host.mjs', 'release-manifest.json', 'release-notes.md'].sort()
    );
    assert.equal(checksumNames.includes('SHA256SUMS'), false);
    for (const line of sums) {
      assert.match(line, /^[0-9a-f]{64}  \S/);
      const fileName = line.replace(/^[0-9a-f]{64}\s+/, '');
      assert.equal(line.slice(0, 64), sha256(path.join(outputDir, fileName)));
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('build-release writes a version-pinned install artifact while root installer stays source-oriented', (t) => {
  const pkg = readJson(path.join(repoRoot, 'package.json'));
  const version = pkg.version;
  const releaseRef = `v${version}`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-release-install-ref-'));
  const outputDir = path.join(tempDir, 'out');
  const binDir = path.join(tempDir, 'bin');
  const installDir = path.join(tempDir, 'source');
  const visibleExtensionLink = path.join(tempDir, 'Codex Overleaf Link Extension');
  const nodeLog = path.join(tempDir, 'node-args.txt');
  const gitLog = path.join(tempDir, 'git-args.txt');

  try {
    const result = spawnSync(process.execPath, [
      path.join(repoRoot, 'scripts/build-release.mjs'),
      '--output',
      outputDir
    ], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    if (result.status !== 0 && /required command "zip"|zip is required/i.test(result.stderr)) {
      t.skip('zip is required to build release artifacts');
      return;
    }
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const rootInstaller = readText(path.join(repoRoot, 'install.sh'));
    const releaseInstaller = readText(path.join(outputDir, 'install.sh'));
    assert.match(rootInstaller, /REF="\$\{CODEX_OVERLEAF_REF:-main\}"/);
    assert.match(releaseInstaller, new RegExp(`REF="\\$\\{CODEX_OVERLEAF_REF:-${releaseRef}\\}"`));
    assert.doesNotMatch(releaseInstaller, /REF="\$\{CODEX_OVERLEAF_REF:-main\}"/);

    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'git'), [
      '#!/bin/bash',
      `printf '%s\\n' "$*" >> "${gitLog}"`,
      'if [ "$1" = "clone" ]; then',
      '  target=""',
      '  for arg in "$@"; do target="$arg"; done',
      '  mkdir -p "$target/.git"',
      '  mkdir -p "$target/extension"',
      `  printf '{"version":"${version}"}\\n' > "$target/package.json"`,
      'fi',
      'exit 0'
    ].join('\n'));
    fs.writeFileSync(path.join(binDir, 'node'), [
      '#!/bin/bash',
      `for arg in "$@"; do printf '%s\\n' "$arg"; done > "${nodeLog}"`,
      'exit 0'
    ].join('\n'));
    for (const command of ['git', 'node']) {
      fs.chmodSync(path.join(binDir, command), 0o755);
    }

    const installResult = spawnSync('/bin/bash', [path.join(outputDir, 'install.sh')], {
      env: {
        HOME: tempDir,
        PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
        CODEX_OVERLEAF_REPO_URL: 'https://example.invalid/repo.git',
        CODEX_OVERLEAF_INSTALL_DIR: installDir,
        CODEX_OVERLEAF_EXTENSION_LINK: visibleExtensionLink
      },
      encoding: 'utf8'
    });

    assert.equal(installResult.status, 0, installResult.stderr || installResult.stdout);
    assert.match(installResult.stdout, new RegExp(`CODEX_OVERLEAF_REF: ${releaseRef}`));
    assert.match(readText(gitLog), new RegExp(`fetch --depth 1 origin ${releaseRef}`));
    assert.match(readText(nodeLog), /scripts\/install-native-host\.mjs/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('native host tarball includes only runtime categories', (t) => {
  const pkg = readJson(path.join(repoRoot, 'package.json'));
  const version = pkg.version;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-release-native-'));
  const outputDir = path.join(tempDir, 'out');

  try {
    const result = spawnSync(process.execPath, [
      path.join(repoRoot, 'scripts/build-release.mjs'),
      '--output',
      outputDir
    ], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    if (result.status !== 0 && /required command "zip"|zip is required/i.test(result.stderr)) {
      t.skip('zip is required to build release artifacts');
      return;
    }
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const entries = listTarEntries(path.join(outputDir, `codex-overleaf-native-host-v${version}.tar.gz`));
    assert.ok(entries.includes('package.json'));
    assert.ok(entries.some((entry) => entry.startsWith('native-host/src/')));
    assert.ok(entries.some((entry) => entry.startsWith('extension/src/shared/')));
    assert.ok(entries.includes('scripts/codex-json-agent.mjs'));
    assert.ok(entries.includes('install.sh'));
    assert.ok(entries.includes('scripts/uninstall-native-host.mjs'));

    const forbiddenPatterns = [
      /^test\//,
      /^docs\//,
      /^\.git(?:\/|$)/,
      /(^|\/)\.DS_Store$/,
      /^dist\//,
      /^extension\/manifest\.json$/,
      /^extension\/popup\.html$/,
      /^extension\/assets\//,
      /^extension\/styles\//,
      /^extension\/src\/(?:background|content|page|popup|contentScript|pageBridge)/
    ];
    for (const pattern of forbiddenPatterns) {
      assert.equal(entries.some((entry) => pattern.test(entry)), false, `unexpected native tarball entry matching ${pattern}`);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('extension zip includes loadable extension files and excludes repository/native files', (t) => {
  const pkg = readJson(path.join(repoRoot, 'package.json'));
  const version = pkg.version;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-release-extension-'));
  const outputDir = path.join(tempDir, 'out');

  try {
    const result = spawnSync(process.execPath, [
      path.join(repoRoot, 'scripts/build-release.mjs'),
      '--output',
      outputDir
    ], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    if (result.status !== 0 && /required command "zip"|zip is required/i.test(result.stderr)) {
      t.skip('zip is required to build release artifacts');
      return;
    }
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const entries = listZipEntries(path.join(outputDir, `codex-overleaf-link-extension-v${version}.zip`), t);
    assert.ok(entries.includes('manifest.json'));
    assert.ok(entries.includes('popup.html'));
    assert.ok(entries.some((entry) => entry.startsWith('src/')));
    assert.ok(entries.some((entry) => entry.startsWith('styles/')));
    assert.ok(entries.some((entry) => entry.startsWith('assets/')));

    const forbiddenPatterns = [
      /^test\//,
      /^docs\//,
      /^\.git(?:\/|$)/,
      /(^|\/)\.DS_Store$/,
      /^dist\//,
      /^native-host\//,
      /^scripts\//,
      /^package\.json$/,
      /^install\.sh$/
    ];
    for (const pattern of forbiddenPatterns) {
      assert.equal(entries.some((entry) => pattern.test(entry)), false, `unexpected extension zip entry matching ${pattern}`);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
