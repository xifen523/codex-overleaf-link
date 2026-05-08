#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FORBIDDEN_NPM_PACKAGE_PATH_PATTERNS = [
  /(^|\/)(docs|specs|superpowers|private|test|tests|fixtures|dist|\.github|node_modules)(\/|$)/,
  /(\.env(?:\.[^/]*)?|\.pem|\.key|\.p12)$/
];

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const repoRoot = path.resolve(scriptDir, '..');
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

function readPackageMetadata() {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
}

function getCurrentPackageTarballName() {
  const packageJson = readPackageMetadata();
  return `${packageJson.name}-${packageJson.version}.tgz`;
}

function runNpm(args) {
  const result = spawnSync('npm', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `npm ${args.join(' ')} exited with status ${result.status}`);
  }

  return result.stdout;
}

function parsePackJsonText(text) {
  const parsed = JSON.parse(text);
  const packuments = Array.isArray(parsed) ? parsed : [parsed];
  return packuments;
}

function getFilePathsFromPackuments(packuments) {
  return packuments.flatMap((packument) => (
    Array.isArray(packument?.files) ? packument.files.map((file) => file.path) : []
  ));
}

function readPackJsonFile(filePath) {
  return getFilePathsFromPackuments(parsePackJsonText(fs.readFileSync(filePath, 'utf8')));
}

function runNpmPackDryRun() {
  return parsePackJsonText(runNpm(['pack', '--dry-run', '--json']));
}

function readNewlineFileList(filePath) {
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
}

function assertVerified(result, label) {
  if (!result.ok) {
    throw new Error(`${label} failed:\n${result.errors.join('\n')}`);
  }
  return result;
}

function verifyActualPaths(actualPaths, label) {
  return assertVerified(verifyPackagePaths(actualPaths), label);
}

function verifyPackuments(packuments, label) {
  return verifyActualPaths(getFilePathsFromPackuments(packuments), label);
}

export function verifyNpmPackDryRun() {
  return verifyPackuments(runNpmPackDryRun(), 'npm pack --dry-run --json verification');
}

export function packAndVerifyNpmPackage() {
  const generatedTarballs = new Set([path.resolve(repoRoot, getCurrentPackageTarballName())]);

  try {
    const dryRunResult = verifyNpmPackDryRun();
    const packuments = parsePackJsonText(runNpm(['pack', '--json']));

    if (packuments.length === 0) {
      throw new Error('npm pack did not report a package artifact.');
    }

    for (const packument of packuments) {
      if (typeof packument?.filename !== 'string' || packument.filename.length === 0) {
        throw new Error('npm pack did not report a package filename.');
      }

      const tarballPath = path.resolve(repoRoot, packument.filename);
      generatedTarballs.add(tarballPath);
      if (!fs.existsSync(tarballPath)) {
        throw new Error(`npm pack did not create expected tarball: ${packument.filename}`);
      }
    }

    return {
      dryRun: dryRunResult,
      packages: packuments.map((packument) => ({
        name: packument.name,
        version: packument.version,
        filename: packument.filename,
        size: packument.size,
        shasum: packument.shasum,
        integrity: packument.integrity
      })),
      tarballs: [...generatedTarballs]
    };
  } finally {
    for (const tarballPath of generatedTarballs) {
      fs.rmSync(tarballPath, { force: true });
    }
  }
}

function printUsage() {
  console.error([
    'Usage:',
    '  node scripts/verify-npm-package.mjs',
    '  node scripts/verify-npm-package.mjs --pack',
    '  node scripts/verify-npm-package.mjs --pack-json <path>',
    '  node scripts/verify-npm-package.mjs --file-list <path>'
  ].join('\n'));
}

function getMode(args) {
  if (args.length === 0) {
    return { mode: '--dry-run' };
  }
  if (args.length === 1 && args[0] === '--pack') {
    return { mode: '--pack' };
  }
  if (args.length !== 2) {
    return null;
  }
  const [mode, filePath] = args;
  if (!['--pack-json', '--file-list'].includes(mode)) {
    return null;
  }
  return { mode, filePath };
}

function readActualPathsForMode(mode, filePath) {
  if (mode === '--dry-run') {
    return getFilePathsFromPackuments(runNpmPackDryRun());
  }
  if (mode === '--pack-json') {
    return readPackJsonFile(filePath);
  }
  if (mode === '--file-list') {
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

  try {
    if (mode.mode === '--pack') {
      const result = packAndVerifyNpmPackage();
      console.log(`Verified npm pack dry-run manifest with ${result.dryRun.actual.length} files.`);
      for (const packageInfo of result.packages) {
        const details = [
          `${packageInfo.name}@${packageInfo.version}`,
          `filename=${packageInfo.filename}`
        ];
        if (Number.isFinite(packageInfo.size)) {
          details.push(`size=${packageInfo.size}`);
        }
        if (packageInfo.shasum) {
          details.push(`shasum=${packageInfo.shasum}`);
        }
        if (packageInfo.integrity) {
          details.push(`integrity=${packageInfo.integrity}`);
        }
        console.log(`Created npm package ${details.join(' ')}`);
      }
      console.log('Removed generated npm tarball.');
      return;
    }

    const result = verifyActualPaths(readActualPathsForMode(mode.mode, mode.filePath), 'npm package manifest verification');
    console.log(`Verified npm package manifest with ${result.actual.length} files.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  await main();
}
