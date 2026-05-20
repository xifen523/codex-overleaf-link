#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyPackagePaths } from './verify-npm-package.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FORBIDDEN_ARCHIVE_PATTERNS = [
  /(^|\/)(docs|specs|superpowers|test|tests|fixtures|dist|\.github|\.git|node_modules)(\/|$)/,
  /(^|\/)(ROADMAP\.md|\.DS_Store)$/,
  /(^|\/)(diagnostics?|logs?|history)(\/|$)/i,
  /(^|\/)(private|secrets?|credentials?|localonly|internal)(\/|$)/i,
  /(\.env(?:\.[^/]*)?|\.pem|\.key|\.p12|\.sqlite|\.log|\.crx)$/i
];

function main() {
  try {
    const result = verifyReleaseArtifacts();
    console.log(`Verified release artifacts for v${result.version}.`);
  } catch (error) {
    console.error(`Release artifact verification failed: ${error.message}`);
    process.exit(1);
  }
}

export function verifyReleaseArtifacts(options = {}) {
  const rootDir = path.resolve(options.rootDir || repoRoot);
  const pkg = readJson(path.join(rootDir, 'package.json'));
  const version = options.version || pkg.version;
  const releaseDir = path.resolve(options.releaseDir || path.join(rootDir, 'dist/releases', `v${version}`));
  const expectedAssets = getExpectedReleaseAssets({ version, packageName: pkg.name });
  const errors = [];

  if (!fs.existsSync(releaseDir) || !fs.statSync(releaseDir).isDirectory()) {
    throw new Error(`Release directory does not exist: ${releaseDir}`);
  }

  const actualAssets = fs.readdirSync(releaseDir)
    .filter(name => name !== '.codex-overleaf-release-output')
    .sort();
  const expectedSorted = expectedAssets.slice().sort();
  const actualSet = new Set(actualAssets);
  const expectedSet = new Set(expectedSorted);
  const missing = expectedSorted.filter(name => !actualSet.has(name));
  const extra = actualAssets.filter(name => !expectedSet.has(name));

  if (missing.length) {
    errors.push(`Missing release assets:\n${missing.map(name => `  - ${name}`).join('\n')}`);
  }
  if (extra.length) {
    errors.push(`Unexpected release assets:\n${extra.map(name => `  - ${name}`).join('\n')}`);
  }

  const extensionZipName = `codex-overleaf-link-extension-v${version}.zip`;
  const nativeTarballName = `codex-overleaf-native-host-v${version}.tar.gz`;
  const npmTarballName = `${pkg.name}-${version}.tgz`;

  if (actualSet.has(extensionZipName)) {
    verifyExtensionZip(path.join(releaseDir, extensionZipName), errors);
  }
  if (actualSet.has(nativeTarballName)) {
    verifyNativeTarball(path.join(releaseDir, nativeTarballName), errors);
  }
  if (actualSet.has(npmTarballName)) {
    verifyNpmTarball(path.join(releaseDir, npmTarballName), errors);
  }
  verifyChecksums(releaseDir, expectedAssets.filter(name => name !== 'SHA256SUMS'), errors);

  if (errors.length) {
    throw new Error(errors.join('\n'));
  }

  return { version, releaseDir, assets: actualAssets };
}

function getExpectedReleaseAssets({ version, packageName }) {
  return [
    `codex-overleaf-link-extension-v${version}.zip`,
    `codex-overleaf-native-host-v${version}.tar.gz`,
    `${packageName}-${version}.tgz`,
    'install.sh',
    'install.ps1',
    'uninstall-native-host.mjs',
    'nativeHostPlatform.js',
    'manifest.js',
    'runtimeInstaller.js',
    'release-manifest.json',
    'release-notes.md',
    'SHA256SUMS'
  ];
}

function verifyExtensionZip(filePath, errors) {
  const entries = listZipEntries(filePath);
  requireEntries(entries, ['manifest.json', 'popup.html'], 'extension zip', errors);
  assertNoForbiddenEntries(entries, 'extension zip', errors);
  const invalid = entries.filter(entry => !/^(manifest\.json|popup\.html|assets\/|src\/|styles\/)/.test(entry));
  if (invalid.length) {
    errors.push(`Extension zip contains entries outside the runtime allowlist:\n${invalid.map(entry => `  - ${entry}`).join('\n')}`);
  }
}

function verifyNativeTarball(filePath, errors) {
  const entries = listTarEntries(filePath);
  requireEntries(entries, ['package.json', 'install.sh', 'install.ps1'], 'native tarball', errors);
  assertNoForbiddenEntries(entries, 'native tarball', errors);
  const invalid = entries.filter(entry => !isAllowedNativeTarballEntry(entry));
  if (invalid.length) {
    errors.push(`Native tarball contains entries outside the runtime allowlist:\n${invalid.map(entry => `  - ${entry}`).join('\n')}`);
  }
}

function isAllowedNativeTarballEntry(entry) {
  return /^(package\.json|package-lock\.json|README\.md|LICENSE|install\.sh|install\.ps1)$/.test(entry)
    || /^(native-host\/|native-host\/src\/|extension\/|extension\/src\/|extension\/src\/shared\/|scripts\/)$/.test(entry)
    || /^native-host\/src\/.+/.test(entry)
    || /^extension\/src\/shared\/.+/.test(entry)
    || /^scripts\/(?:codex-json-agent|install-native-host|uninstall-native-host|verify-npm-package)\.mjs$/.test(entry);
}

function verifyNpmTarball(filePath, errors) {
  const entries = listTarEntries(filePath);
  const verification = verifyPackagePaths(entries);
  if (!verification.ok) {
    errors.push(`npm tarball verification failed:\n${verification.errors.join('\n')}`);
  }
}

function verifyChecksums(releaseDir, expectedChecksumNames, errors) {
  const checksumPath = path.join(releaseDir, 'SHA256SUMS');
  if (!fs.existsSync(checksumPath)) {
    errors.push('SHA256SUMS is missing.');
    return;
  }
  const expected = expectedChecksumNames.slice().sort();
  const rows = fs.readFileSync(checksumPath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  const parsed = rows.map(row => {
    const match = row.match(/^([0-9a-f]{64})\s+\*?(.+)$/);
    if (!match) {
      errors.push(`Invalid SHA256SUMS row: ${row}`);
      return null;
    }
    return { hash: match[1], name: match[2] };
  }).filter(Boolean);
  const actual = parsed.map(row => row.name).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(`SHA256SUMS asset list mismatch:\nexpected ${expected.join(', ')}\nactual ${actual.join(', ')}`);
  }
  for (const row of parsed) {
    const artifactPath = path.join(releaseDir, row.name);
    if (!fs.existsSync(artifactPath)) {
      errors.push(`SHA256SUMS references missing asset: ${row.name}`);
      continue;
    }
    const actualHash = crypto.createHash('sha256').update(fs.readFileSync(artifactPath)).digest('hex');
    if (actualHash !== row.hash) {
      errors.push(`SHA256 mismatch for ${row.name}: expected ${row.hash}, got ${actualHash}`);
    }
  }
}

function assertNoForbiddenEntries(entries, label, errors) {
  const forbidden = entries.filter(entry => FORBIDDEN_ARCHIVE_PATTERNS.some(pattern => pattern.test(entry)));
  if (forbidden.length) {
    errors.push(`${label} contains forbidden entries:\n${forbidden.map(entry => `  - ${entry}`).join('\n')}`);
  }
}

function requireEntries(entries, required, label, errors) {
  const set = new Set(entries);
  const missing = required.filter(entry => !set.has(entry));
  if (missing.length) {
    errors.push(`${label} is missing required entries:\n${missing.map(entry => `  - ${entry}`).join('\n')}`);
  }
}

function listTarEntries(filePath) {
  const result = spawnSync('tar', ['-tzf', filePath], { encoding: 'utf8' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `tar failed for ${filePath}`);
  }
  return result.stdout.split(/\r?\n/).filter(Boolean).map(normalizeArchiveEntry);
}

function listZipEntries(filePath) {
  const result = spawnSync('unzip', ['-Z1', filePath], { encoding: 'utf8' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `unzip failed for ${filePath}`);
  }
  return result.stdout.split(/\r?\n/).filter(Boolean).map(normalizeArchiveEntry);
}

function normalizeArchiveEntry(entry) {
  return String(entry || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^package\//, '');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
