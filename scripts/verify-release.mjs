#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CHROME_WEB_STORE_DOCS = [
  'permissions.md',
  'privacy.md',
  'listing.md',
  'release-checklist.md'
];
const EXPECTED_PACKAGE_NAME = 'codex-overleaf-link';
const EXPECTED_PACKAGE_LOCK_VERSION = 3;
export const FORBIDDEN_TRACKED_PATH_PATTERNS = [
  /^\.local\//,
  /^docs\/superpowers\//,
  /^dist\//,
  /^build\//,
  /^native-host\/bin\//,
  /^\.worktrees\//,
  /^worktrees\//,
  /\.(pem|key|p12|crx|sqlite|log)$/i
];
const PACKAGED_SOURCE_TREE_PREFIXES = [
  'extension/',
  'native-host/',
  'scripts/'
];
const FORBIDDEN_PACKAGED_SOURCE_PATH_TOKENS = new Set([
  'credential',
  'credentials',
  'debug',
  'env',
  'internal',
  'local',
  'localonly',
  'plan',
  'private',
  'secret',
  'secrets',
  'spec'
]);
const RELEASE_CHECKLIST_REQUIRED_SECTIONS = [
  'Automated Verification',
  'Release Artifact Hygiene',
  'Real Overleaf Smoke',
  'Large-Project Performance Baseline',
  'Security And Privacy Review',
  'Documentation Pass',
  'Compatibility Matrix',
  'P0/P1 Signoff'
];

export function collectReleaseVerificationErrors(options = {}) {
  const rootDir = path.resolve(options.rootDir || getRepoRoot());
  const releaseDate = options.releaseDate;
  const errors = [];
  const pkg = readJsonFile(rootDir, 'package.json', errors);
  const packageLock = readJsonFile(rootDir, 'package-lock.json', errors);
  const manifest = readJsonFile(rootDir, 'extension/manifest.json', errors);
  const readme = readTextFile(rootDir, 'README.md', errors);
  const changelog = readTextFile(rootDir, 'CHANGELOG.md', errors);

  if (errors.length > 0) {
    return errors;
  }

  const version = pkg.version;
  errors.push(...collectPackageMetadataErrors({ rootDir, pkg, packageLock }));
  if (!version) {
    errors.push('package.json must define a release version.');
  }

  if (manifest.version !== version) {
    errors.push(
      `extension/manifest.json version ${formatValue(manifest.version)} must match package.json version ${version}.`
    );
  }

  if (version) {
    const expectedBadge = `version-${version}-blue`;
    if (!readme.includes(expectedBadge)) {
      errors.push(`README.md must contain the release badge fragment "${expectedBadge}".`);
    }

    const pinnedNpmInstallCommand = `npm exec --yes ${EXPECTED_PACKAGE_NAME}@${version} -- install-native --extension-id <chrome-extension-id>`;
    if (!readme.includes(pinnedNpmInstallCommand)) {
      errors.push(`README.md must contain the pinned npm install command "${pinnedNpmInstallCommand}".`);
    }

    const changelogHeadingPattern = releaseDate
      ? new RegExp(`^## v${escapeRegExp(version)} - ${escapeRegExp(releaseDate)}$`, 'm')
      : new RegExp(`^## v${escapeRegExp(version)} - \\d{4}-\\d{2}-\\d{2}$`, 'm');
    if (!changelogHeadingPattern.test(changelog)) {
      const expectedHeading = releaseDate
        ? `## v${version} - ${releaseDate}`
        : `## v${version} - YYYY-MM-DD`;
      errors.push(`CHANGELOG.md must contain the release heading "${expectedHeading}".`);
    }
  }

  errors.push(...collectForbiddenTrackedPathErrors(rootDir, options.trackedFiles));
  errors.push(...collectInstallerArtifactErrors(rootDir));
  if (version) {
    errors.push(...collectChromeWebStoreDocErrors(rootDir, version));
  } else {
    errors.push(...collectChromeWebStoreDocErrors(rootDir));
  }
  return errors;
}

function collectPackageMetadataErrors({ rootDir, pkg, packageLock }) {
  const errors = [];
  const version = pkg.version;

  if (pkg.name !== EXPECTED_PACKAGE_NAME) {
    errors.push(`package.json name ${formatValue(pkg.name)} must be ${EXPECTED_PACKAGE_NAME}.`);
  }
  if (typeof pkg.packageManager !== 'string' || pkg.packageManager.trim() === '') {
    errors.push('package.json must define packageManager for reproducible npm release tooling.');
  }
  if (packageLock.lockfileVersion !== EXPECTED_PACKAGE_LOCK_VERSION) {
    errors.push(
      `package-lock.json lockfileVersion ${formatValue(packageLock.lockfileVersion)} must be ${EXPECTED_PACKAGE_LOCK_VERSION}.`
    );
  }

  if (version) {
    if (packageLock.name !== EXPECTED_PACKAGE_NAME) {
      errors.push(`package-lock.json name ${formatValue(packageLock.name)} must be ${EXPECTED_PACKAGE_NAME}.`);
    }
    if (packageLock.version !== version) {
      errors.push(`package-lock.json version ${formatValue(packageLock.version)} must match package.json version ${version}.`);
    }
    const rootPackage = packageLock.packages && packageLock.packages[''];
    if (!rootPackage || typeof rootPackage !== 'object') {
      errors.push('package-lock.json must include a root packages[""] entry.');
    } else {
      if (rootPackage.name !== EXPECTED_PACKAGE_NAME) {
        errors.push(`package-lock.json root package name ${formatValue(rootPackage.name)} must be ${EXPECTED_PACKAGE_NAME}.`);
      }
      if (rootPackage.version !== version) {
        errors.push(`package-lock.json root package version ${formatValue(rootPackage.version)} must match package.json version ${version}.`);
      }
    }

    const npmManifestPath = path.join(rootDir, 'scripts', `npm-package-files-v${version}.txt`);
    if (!fs.existsSync(npmManifestPath)) {
      errors.push(`scripts/npm-package-files-v${version}.txt is required for exact npm package manifest verification.`);
    }
  }

  return errors;
}

export function collectForbiddenTrackedPathErrors(rootDir, trackedFiles = readGitTrackedFiles(rootDir)) {
  const errors = [];
  for (const trackedFile of trackedFiles) {
    const relativePath = normalizeTrackedPath(trackedFile);
    if (isForbiddenTrackedReleasePath(relativePath)) {
      errors.push(`Tracked release input must not include internal/private path: ${relativePath}`);
    }
  }
  return errors;
}

export function collectInstallerArtifactErrors(rootDir) {
  const errors = [];
  for (const relativePath of ['install.sh', 'install.ps1', 'scripts/install-native-host.mjs']) {
    if (!fs.existsSync(path.join(rootDir, relativePath))) {
      errors.push(`${relativePath} is required for release verification.`);
    }
  }
  return errors;
}

export function collectChromeWebStoreDocErrors(rootDir, version = '') {
  const docsDir = path.join(rootDir, 'docs', 'chrome-web-store');
  const errors = [];
  for (const fileName of CHROME_WEB_STORE_DOCS) {
    const docPath = path.join(docsDir, fileName);
    if (!fs.existsSync(docPath)) {
      errors.push(`docs/chrome-web-store/${fileName} is required for release verification.`);
    }
  }
  if (errors.length === 0 && version) {
    errors.push(...collectReleaseChecklistErrors(docsDir, version));
  }
  return errors;
}

function collectReleaseChecklistErrors(docsDir, version) {
  const errors = [];
  const relativePath = 'docs/chrome-web-store/release-checklist.md';
  const checklist = fs.readFileSync(path.join(docsDir, 'release-checklist.md'), 'utf8');
  const releaseRef = `v${version}`;
  const requiredFragments = [
    `dist/releases/${releaseRef}/SHA256SUMS`,
    `codex-overleaf-link-extension-${releaseRef}.zip`,
    `codex-overleaf-native-host-${releaseRef}.tar.gz`,
    `codex-overleaf-link-${version}.tgz`,
    'npm run verify:npm-package',
    'npm package upload',
    'install.ps1'
  ];

  for (const fragment of requiredFragments) {
    if (!checklist.includes(fragment)) {
      errors.push(`${relativePath} must reference current ${releaseRef} release instruction "${fragment}".`);
    }
  }
  for (const section of RELEASE_CHECKLIST_REQUIRED_SECTIONS) {
    if (!hasMarkdownSection(checklist, section)) {
      errors.push(`${relativePath} must include a "${section}" section for v0.9 release readiness.`);
    }
  }
  if (!hasP0P1IssueSignoff(checklist)) {
    errors.push(`${relativePath} must include a P0/P1 issue signoff command using "gh issue list --search 'is:issue is:open (label:P0 OR label:P1)'" or separate P0 and P1 label checks.`);
  }
  if (/\bv0\.4(?:\.0)?\b/i.test(checklist)) {
    errors.push(`${relativePath} must not reference stale v0.4 release instructions.`);
  }
  return errors;
}

function readJsonFile(rootDir, relativePath, errors) {
  const fullPath = path.join(rootDir, relativePath);
  try {
    return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  } catch (error) {
    errors.push(`Unable to read valid JSON from ${relativePath}: ${error.message}`);
    return {};
  }
}

function readTextFile(rootDir, relativePath, errors) {
  const fullPath = path.join(rootDir, relativePath);
  try {
    return fs.readFileSync(fullPath, 'utf8');
  } catch (error) {
    errors.push(`Unable to read ${relativePath}: ${error.message}`);
    return '';
  }
}

function formatValue(value) {
  return value === undefined ? '<missing>' : String(value);
}

function hasMarkdownSection(markdown, section) {
  return new RegExp(`^#{2,6}\\s+${escapeRegExp(section)}\\s*$`, 'im').test(markdown);
}

function hasP0P1IssueSignoff(checklist) {
  const hasCombinedSearch = /gh issue list --search ["']is:issue is:open \(label:P0 OR label:P1\)["']/.test(checklist);
  const hasSeparateChecks = /gh issue list --state open --label P0\b/.test(checklist)
    && /gh issue list --state open --label P1\b/.test(checklist);
  return hasCombinedSearch || hasSeparateChecks;
}

function normalizeTrackedPath(relativePath) {
  return String(relativePath).replace(/\\/g, '/').replace(/^\.\//, '');
}

function isForbiddenTrackedReleasePath(relativePath) {
  return FORBIDDEN_TRACKED_PATH_PATTERNS.some((pattern) => pattern.test(relativePath))
    || isForbiddenPackagedSourceTreePath(relativePath);
}

function isForbiddenPackagedSourceTreePath(relativePath) {
  if (!PACKAGED_SOURCE_TREE_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) {
    return false;
  }

  return relativePath
    .toLowerCase()
    .split('/')
    .some((component) => getPathComponentTokens(component)
      .some((token) => FORBIDDEN_PACKAGED_SOURCE_PATH_TOKENS.has(token)));
}

function getPathComponentTokens(component) {
  return component
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function readGitTrackedFiles(rootDir) {
  const insideWorkTree = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: rootDir,
    encoding: 'utf8'
  });
  if (insideWorkTree.status !== 0) {
    return [];
  }

  const result = spawnSync('git', ['ls-files'], {
    cwd: rootDir,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    throw new Error(`Unable to list git-tracked files: ${result.stderr || result.stdout}`.trim());
  }
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      parsed.rootDir = argv[index + 1];
      index += 1;
    } else if (arg === '--release-date') {
      parsed.releaseDate = argv[index + 1];
      index += 1;
    }
  }
  return parsed;
}

function getRepoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const errors = collectReleaseVerificationErrors(args);
  if (errors.length > 0) {
    console.error('Release verification failed:');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(path.resolve(args.rootDir || getRepoRoot()), 'package.json'), 'utf8'));
  console.log(`Release verification passed for v${pkg.version}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
