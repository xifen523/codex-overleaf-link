#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_RELEASE_DATE = '2026-05-06';
const CHROME_WEB_STORE_DOCS = [
  'permissions.md',
  'privacy.md',
  'listing.md',
  'release-checklist.md'
];

export function collectReleaseVerificationErrors(options = {}) {
  const rootDir = path.resolve(options.rootDir || getRepoRoot());
  const releaseDate = options.releaseDate || DEFAULT_RELEASE_DATE;
  const errors = [];
  const pkg = readJsonFile(rootDir, 'package.json', errors);
  const manifest = readJsonFile(rootDir, 'extension/manifest.json', errors);
  const readme = readTextFile(rootDir, 'README.md', errors);
  const changelog = readTextFile(rootDir, 'CHANGELOG.md', errors);

  if (errors.length > 0) {
    return errors;
  }

  const version = pkg.version;
  if (!version) {
    errors.push('package.json must define a release version.');
    return errors;
  }

  if (manifest.version !== version) {
    errors.push(
      `extension/manifest.json version ${formatValue(manifest.version)} must match package.json version ${version}.`
    );
  }

  const expectedBadge = `version-${version}-blue`;
  if (!readme.includes(expectedBadge)) {
    errors.push(`README.md must contain the release badge fragment "${expectedBadge}".`);
  }

  const expectedHeading = `## v${version} - ${releaseDate}`;
  if (!changelog.includes(expectedHeading)) {
    errors.push(`CHANGELOG.md must contain the release heading "${expectedHeading}".`);
  }

  errors.push(...collectChromeWebStoreDocErrors(rootDir));
  return errors;
}

export function collectChromeWebStoreDocErrors(rootDir) {
  const docsDir = path.join(rootDir, 'docs', 'chrome-web-store');
  if (!fs.existsSync(docsDir)) {
    return [];
  }

  const errors = [];
  for (const fileName of CHROME_WEB_STORE_DOCS) {
    const docPath = path.join(docsDir, fileName);
    if (!fs.existsSync(docPath)) {
      errors.push(`docs/chrome-web-store/${fileName} is required when Chrome Web Store docs are present.`);
    }
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
