#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FORBIDDEN_NPM_PACKAGE_PATH_PATTERNS = [
  /(^|\/)(docs|specs|superpowers|private|test|tests|fixtures|dist|\.github|node_modules)(\/|$)/,
  /(\.env|\.pem|\.key|\.p12)$/
];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultManifestPath = path.join(scriptDir, 'npm-package-files-v1.1.0.txt');

export function normalizePackagePathList(paths) {
  const normalized = new Set();

  for (const rawPath of paths) {
    if (typeof rawPath !== 'string') {
      continue;
    }

    let packagePath = rawPath.trim().replace(/\\/g, '/');
    packagePath = packagePath.replace(/^\.\//, '').replace(/^\/+/, '');
    packagePath = packagePath.replace(/\/+$|\r$/g, '');

    if (!packagePath) {
      continue;
    }

    if (!packagePath.startsWith('package/')) {
      packagePath = `package/${packagePath}`;
    }

    normalized.add(packagePath);
  }

  return [...normalized].sort();
}

export function findForbiddenNpmPackagePaths(paths) {
  return normalizePackagePathList(paths).filter((packagePath) => (
    FORBIDDEN_NPM_PACKAGE_PATH_PATTERNS.some((pattern) => pattern.test(packagePath))
  ));
}

export function compareExactManifest(actualPaths, expectedPaths) {
  const actual = normalizePackagePathList(actualPaths);
  const expected = normalizePackagePathList(expectedPaths);
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);

  return {
    missing: expected.filter((packagePath) => !actualSet.has(packagePath)),
    extra: actual.filter((packagePath) => !expectedSet.has(packagePath))
  };
}

export function readExpectedManifest(manifestPath = defaultManifestPath) {
  return normalizePackagePathList(
    fs.readFileSync(manifestPath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
  );
}

export function verifyPackagePaths(actualPaths, expectedPaths = readExpectedManifest()) {
  const actual = normalizePackagePathList(actualPaths);
  const expected = normalizePackagePathList(expectedPaths);
  const forbidden = findForbiddenNpmPackagePaths(actual);
  const { missing, extra } = compareExactManifest(actual, expected);
  const errors = [];

  if (forbidden.length > 0) {
    errors.push(`Forbidden npm package paths:\n${forbidden.map((packagePath) => `  - ${packagePath}`).join('\n')}`);
  }
  if (missing.length > 0) {
    errors.push(`Missing npm package manifest entries:\n${missing.map((packagePath) => `  - ${packagePath}`).join('\n')}`);
  }
  if (extra.length > 0) {
    errors.push(`Extra npm package manifest entries:\n${extra.map((packagePath) => `  - ${packagePath}`).join('\n')}`);
  }

  return {
    ok: errors.length === 0,
    actual,
    expected,
    forbidden,
    missing,
    extra,
    errors
  };
}

function readPackJsonFile(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const packuments = Array.isArray(parsed) ? parsed : [parsed];
  return packuments.flatMap((packument) => (
    Array.isArray(packument?.files) ? packument.files.map((file) => file.path) : []
  ));
}

function readTarballFileList(filePath) {
  const result = spawnSync('tar', ['-tzf', filePath], { encoding: 'utf8' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `tar exited with status ${result.status}`);
  }
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function readNewlineFileList(filePath) {
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
}

function printUsage() {
  console.error([
    'Usage:',
    '  node scripts/verify-npm-package.mjs --pack-json <path>',
    '  node scripts/verify-npm-package.mjs --tarball <path>',
    '  node scripts/verify-npm-package.mjs --file-list <path>'
  ].join('\n'));
}

function getMode(args) {
  if (args.length === 0) {
    return { mode: 'file-list', filePath: defaultManifestPath };
  }
  if (args.length !== 2) {
    return null;
  }
  const [mode, filePath] = args;
  if (!['--pack-json', '--tarball', '--file-list'].includes(mode)) {
    return null;
  }
  return { mode, filePath };
}

function readActualPathsForMode(mode, filePath) {
  if (mode === '--pack-json') {
    return readPackJsonFile(filePath);
  }
  if (mode === '--tarball') {
    return readTarballFileList(filePath);
  }
  if (mode === '--file-list' || mode === 'file-list') {
    return readNewlineFileList(filePath);
  }
  throw new Error(`Unsupported mode: ${mode}`);
}

async function main() {
  const mode = getMode(process.argv.slice(2));
  if (!mode) {
    printUsage();
    process.exitCode = 2;
    return;
  }

  let actualPaths;
  try {
    actualPaths = readActualPathsForMode(mode.mode, mode.filePath);
  } catch (error) {
    console.error(`Failed to read npm package file list: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const result = verifyPackagePaths(actualPaths);
  if (!result.ok) {
    console.error(result.errors.join('\n'));
    process.exitCode = 1;
    return;
  }

  console.log(`Verified npm package manifest with ${result.actual.length} files.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
