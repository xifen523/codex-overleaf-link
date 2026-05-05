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

test('package exposes release verification and artifact build commands', () => {
  const pkg = readJson(path.join(repoRoot, 'package.json'));

  assert.equal(pkg.scripts['verify:release'], 'node scripts/verify-release.mjs');
  assert.equal(pkg.scripts['build:release'], 'node scripts/build-release.mjs');
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

test('release verifier checks Chrome Web Store docs only when docs directory exists', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-release-docs-'));
  try {
    writeReleaseFixture(tempDir);
    const moduleUrl = pathToFileURL(path.join(repoRoot, 'scripts/verify-release.mjs')).href;
    const { collectReleaseVerificationErrors } = await import(moduleUrl);

    assert.deepEqual(collectReleaseVerificationErrors({ rootDir: tempDir, releaseDate: '2026-05-06' }), []);

    const docsDir = path.join(tempDir, 'docs/chrome-web-store');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, 'permissions.md'), 'permissions\n');

    const missingDocErrors = collectReleaseVerificationErrors({
      rootDir: tempDir,
      releaseDate: '2026-05-06'
    });
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

    for (const fileName of ['privacy.md', 'listing.md', 'release-checklist.md']) {
      fs.writeFileSync(path.join(docsDir, fileName), `${fileName}\n`);
    }
    assert.deepEqual(collectReleaseVerificationErrors({ rootDir: tempDir, releaseDate: '2026-05-06' }), []);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
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
