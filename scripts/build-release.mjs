#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = buildRelease({
      rootDir: repoRoot,
      outputDir: args.output
    });
    console.log(`Built release artifacts in ${result.outputDir}`);
  } catch (error) {
    console.error(`Release build failed: ${error.message}`);
    process.exit(1);
  }
}

export function buildRelease(options = {}) {
  const rootDir = path.resolve(options.rootDir || repoRoot);
  const pkg = readJson(path.join(rootDir, 'package.json'));
  const version = pkg.version;
  if (!version) {
    throw new Error('package.json must define a version.');
  }

  const outputDir = path.resolve(options.outputDir || path.join(rootDir, 'dist/releases', `v${version}`));
  const extensionZipName = `codex-overleaf-link-extension-v${version}.zip`;
  const nativeTarballName = `codex-overleaf-native-host-v${version}.tar.gz`;
  const extensionZipPath = path.join(outputDir, extensionZipName);
  const nativeTarballPath = path.join(outputDir, nativeTarballName);

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  createExtensionZip({ rootDir, outputPath: extensionZipPath });
  createNativeTarball({ rootDir, outputPath: nativeTarballPath });

  const copiedInstallPath = path.join(outputDir, 'install.sh');
  const copiedUninstallPath = path.join(outputDir, 'uninstall-native-host.mjs');
  copyFile(path.join(rootDir, 'install.sh'), copiedInstallPath);
  copyFile(path.join(rootDir, 'scripts/uninstall-native-host.mjs'), copiedUninstallPath);

  const releaseNotes = extractReleaseNotes(
    fs.readFileSync(path.join(rootDir, 'CHANGELOG.md'), 'utf8'),
    version
  );
  fs.writeFileSync(path.join(outputDir, 'release-notes.md'), releaseNotes, 'utf8');

  const payloadArtifactNames = [
    extensionZipName,
    nativeTarballName,
    'install.sh',
    'uninstall-native-host.mjs'
  ];
  const manifest = {
    version,
    gitCommit: getGitCommit(rootDir),
    createdAt: new Date().toISOString(),
    artifacts: payloadArtifactNames.map((name) => describeArtifact(path.join(outputDir, name), name))
  };
  fs.writeFileSync(path.join(outputDir, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const checksumNames = [
    ...payloadArtifactNames,
    'release-manifest.json',
    'release-notes.md'
  ];
  const checksums = checksumNames
    .map((name) => `${sha256(path.join(outputDir, name))}  ${name}`)
    .join('\n');
  fs.writeFileSync(path.join(outputDir, 'SHA256SUMS'), `${checksums}\n`, 'utf8');

  return {
    outputDir,
    version,
    artifacts: [
      ...payloadArtifactNames,
      'release-manifest.json',
      'release-notes.md',
      'SHA256SUMS'
    ]
  };
}

export function extractReleaseNotes(changelog, version) {
  const headingPattern = new RegExp(`^## v${escapeRegExp(version)} - .*$`, 'm');
  const headingMatch = changelog.match(headingPattern);
  if (!headingMatch || headingMatch.index === undefined) {
    throw new Error(`CHANGELOG.md does not contain a release section for v${version}.`);
  }

  const sectionStart = headingMatch.index;
  const rest = changelog.slice(sectionStart);
  const nextHeadingMatch = rest.slice(headingMatch[0].length).match(/\n## /);
  const sectionEnd = nextHeadingMatch
    ? headingMatch[0].length + nextHeadingMatch.index
    : rest.length;
  const section = rest.slice(0, sectionEnd).trim();
  if (!section) {
    throw new Error(`CHANGELOG.md release section for v${version} is empty.`);
  }
  return `${section}\n`;
}

function createExtensionZip({ rootDir, outputPath }) {
  const extensionDir = path.join(rootDir, 'extension');
  runRequiredCommand('zip', [
    '-qr',
    outputPath,
    'manifest.json',
    'popup.html',
    'src',
    'styles',
    'assets',
    '-x',
    '*.DS_Store',
    '*/.DS_Store',
    '.git/*',
    '*/.git/*',
    'dist/*',
    '*/dist/*',
    'docs/*',
    '*/docs/*',
    'test/*',
    '*/test/*'
  ], { cwd: extensionDir });
}

function createNativeTarball({ rootDir, outputPath }) {
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-native-release-'));
  try {
    copyFile(path.join(rootDir, 'package.json'), path.join(stagingRoot, 'package.json'));
    copyDirectory(path.join(rootDir, 'native-host/src'), path.join(stagingRoot, 'native-host/src'));
    copyDirectory(path.join(rootDir, 'extension/src/shared'), path.join(stagingRoot, 'extension/src/shared'));
    copyFile(path.join(rootDir, 'scripts/codex-json-agent.mjs'), path.join(stagingRoot, 'scripts/codex-json-agent.mjs'));
    copyFile(path.join(rootDir, 'install.sh'), path.join(stagingRoot, 'install.sh'));
    copyFile(
      path.join(rootDir, 'scripts/uninstall-native-host.mjs'),
      path.join(stagingRoot, 'scripts/uninstall-native-host.mjs')
    );

    runRequiredCommand('tar', [
      '-czf',
      outputPath,
      '-C',
      stagingRoot,
      'package.json',
      'native-host',
      'extension',
      'scripts',
      'install.sh'
    ]);
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function copyDirectory(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') {
      continue;
    }
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
    } else if (entry.isFile()) {
      copyFile(sourcePath, targetPath);
    }
  }
}

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  fs.chmodSync(target, fs.statSync(source).mode & 0o777);
}

function describeArtifact(filePath, name) {
  return {
    name,
    size: fs.statSync(filePath).size,
    sha256: sha256(filePath)
  };
}

function getGitCommit(rootDir) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: rootDir,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    return 'unknown';
  }
  const commit = result.stdout.trim();
  return /^[0-9a-f]{40}$/.test(commit) ? commit : 'unknown';
}

function runRequiredCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    ...options,
    env: {
      ...process.env,
      COPYFILE_DISABLE: '1'
    },
    encoding: 'utf8'
  });
  if (result.error && result.error.code === 'ENOENT') {
    throw new Error(`Required command "${command}" was not found on PATH.`);
  }
  if (result.status !== 0) {
    throw new Error(`Command "${command} ${args.join(' ')}" failed: ${result.stderr || result.stdout}`);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output') {
      parsed.output = argv[index + 1];
      index += 1;
    }
  }
  return parsed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
