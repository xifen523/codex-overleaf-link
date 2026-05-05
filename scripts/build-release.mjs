#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE_OUTPUT_MARKER = '.codex-overleaf-release-output';
const BUILD_RELEASE_USAGE = 'Usage: node scripts/build-release.mjs [--output <path>]';

function main() {
  try {
    const args = parseBuildReleaseArgs(process.argv.slice(2));
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

  const outputDir = path.resolve(options.outputDir || getDefaultReleaseOutputDir({ rootDir, version }));
  const extensionZipName = `codex-overleaf-link-extension-v${version}.zip`;
  const nativeTarballName = `codex-overleaf-native-host-v${version}.tar.gz`;
  const extensionZipPath = path.join(outputDir, extensionZipName);
  const nativeTarballPath = path.join(outputDir, nativeTarballName);
  const trackedFiles = getGitTrackedFiles(rootDir);
  const headTrackedFiles = getGitHeadTrackedFiles(rootDir);
  const releaseInputFiles = getReleaseInputFilesForProvenance({
    headTrackedFiles,
    indexTrackedFiles: trackedFiles
  });

  assertSafeReleaseOutputDir({ rootDir, outputDir });
  assertCleanTrackedReleaseInputs({ rootDir, relativePaths: releaseInputFiles });
  prepareReleaseOutputDir({ rootDir, outputDir });

  createExtensionZip({ rootDir, outputPath: extensionZipPath, trackedFiles });
  createNativeTarball({ rootDir, outputPath: nativeTarballPath, trackedFiles });

  const copiedInstallPath = path.join(outputDir, 'install.sh');
  const copiedUninstallPath = path.join(outputDir, 'uninstall-native-host.mjs');
  writeVersionPinnedInstallScript({
    sourcePath: path.join(rootDir, 'install.sh'),
    targetPath: copiedInstallPath,
    version
  });
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

  const rest = changelog.slice(headingMatch.index);
  const bodyAndFollowingSections = rest.slice(headingMatch[0].length);
  const nextHeadingMatch = bodyAndFollowingSections.match(/\n## /);
  const body = (nextHeadingMatch
    ? bodyAndFollowingSections.slice(0, nextHeadingMatch.index)
    : bodyAndFollowingSections
  ).trim();
  if (!body) {
    throw new Error(`CHANGELOG.md release section for v${version} is empty.`);
  }
  return `${headingMatch[0]}\n\n${body}\n`;
}

export function getDefaultReleaseOutputDir({ rootDir, version }) {
  return path.join(rootDir, 'dist/releases', `v${version}`);
}

export function assertSafeReleaseOutputDir({ rootDir, outputDir }) {
  if (!outputDir) {
    throw new Error('Refusing to use unsafe release output directory: output path is required.');
  }

  const resolvedRoot = path.resolve(rootDir);
  const resolvedOutput = path.resolve(outputDir);
  const filesystemRoot = path.parse(resolvedOutput).root;
  const homeDir = path.resolve(os.homedir());

  if (
    resolvedOutput === filesystemRoot ||
    resolvedOutput === homeDir ||
    isSamePathOrAncestor(resolvedOutput, resolvedRoot)
  ) {
    throw new Error(`Refusing to use unsafe release output directory: ${resolvedOutput}`);
  }

  if (!fs.existsSync(resolvedOutput)) {
    return;
  }

  const outputStats = fs.statSync(resolvedOutput);
  if (!outputStats.isDirectory()) {
    throw new Error(`Refusing to use unsafe release output directory because it is not a directory: ${resolvedOutput}`);
  }

  const entries = fs.readdirSync(resolvedOutput);
  if (entries.length > 0 && !entries.includes(RELEASE_OUTPUT_MARKER)) {
    throw new Error(
      `Refusing to use non-empty release output directory without ${RELEASE_OUTPUT_MARKER}: ${resolvedOutput}`
    );
  }
}

export function parseBuildReleaseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`--output requires a path value.\n${BUILD_RELEASE_USAGE}`);
      }
      parsed.output = value;
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}\n${BUILD_RELEASE_USAGE}`);
    }
  }
  return parsed;
}

export function assertCleanTrackedReleaseInputs({ rootDir, relativePaths }) {
  const dirtyFiles = getDirtyTrackedFiles({
    rootDir,
    relativePaths: [...new Set(relativePaths.map(validateTrackedRelativePath))].sort()
  });
  if (dirtyFiles.length === 0) {
    return;
  }

  throw new Error([
    'Tracked release input files have uncommitted changes:',
    ...dirtyFiles.map((relativePath) => `- ${relativePath}`),
    'Commit or stash these changes before building release artifacts.'
  ].join('\n'));
}

function prepareReleaseOutputDir({ rootDir, outputDir }) {
  assertSafeReleaseOutputDir({ rootDir, outputDir });
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, RELEASE_OUTPUT_MARKER), 'codex-overleaf release output\n', 'utf8');
}

function isSamePathOrAncestor(candidateAncestor, targetPath) {
  const relative = path.relative(candidateAncestor, targetPath);
  return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function createExtensionZip({ rootDir, outputPath, trackedFiles }) {
  const extensionDir = path.join(rootDir, 'extension');
  const extensionFiles = getExtensionArchiveFiles(trackedFiles);
  runRequiredCommand('zip', [
    '-qr',
    outputPath,
    ...extensionFiles
  ], { cwd: extensionDir });
}

function createNativeTarball({ rootDir, outputPath, trackedFiles }) {
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-native-release-'));
  try {
    for (const relativePath of getNativeTarballFiles(trackedFiles)) {
      copyTrackedFile({ rootDir, stagingRoot, relativePath, trackedFiles });
    }

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

function getGitTrackedFiles(rootDir) {
  const result = spawnSync('git', ['ls-files', '-z'], {
    cwd: rootDir,
    encoding: 'utf8'
  });
  if (result.error && result.error.code === 'ENOENT') {
    throw new Error('Required command "git" was not found on PATH.');
  }
  if (result.status !== 0) {
    throw new Error(`Unable to list git-tracked files: ${result.stderr || result.stdout}`);
  }
  return new Set(result.stdout.split('\0').filter(Boolean).map(validateTrackedRelativePath));
}

function getGitHeadTrackedFiles(rootDir) {
  const result = spawnSync('git', ['ls-tree', '-r', '-z', '--name-only', 'HEAD'], {
    cwd: rootDir,
    encoding: 'utf8'
  });
  if (result.error && result.error.code === 'ENOENT') {
    throw new Error('Required command "git" was not found on PATH.');
  }
  if (result.status !== 0) {
    throw new Error(`Unable to list HEAD-tracked files: ${result.stderr || result.stdout}`);
  }
  return new Set(result.stdout.split('\0').filter(Boolean).map(validateTrackedRelativePath));
}

function getReleaseInputFilesForProvenance({ headTrackedFiles, indexTrackedFiles }) {
  return [...new Set([
    ...getReleaseInputFiles(headTrackedFiles),
    ...getReleaseInputFiles(indexTrackedFiles)
  ])].sort();
}

function getReleaseInputFiles(trackedFiles) {
  return [...new Set([
    'CHANGELOG.md',
    ...getNativeTarballFiles(trackedFiles),
    ...getExtensionArchiveFiles(trackedFiles).map((relativePath) => `extension/${relativePath}`)
  ])].sort();
}

function getDirtyTrackedFiles({ rootDir, relativePaths }) {
  if (relativePaths.length === 0) {
    return [];
  }

  const result = spawnSync('git', ['status', '--porcelain=v1', '-z', '--', ...relativePaths], {
    cwd: rootDir,
    encoding: 'utf8'
  });
  if (result.error && result.error.code === 'ENOENT') {
    throw new Error('Required command "git" was not found on PATH.');
  }
  if (result.status !== 0) {
    throw new Error(`Unable to inspect release input status: ${result.stderr || result.stdout}`);
  }
  return parseDirtyTrackedStatus(result.stdout);
}

function parseDirtyTrackedStatus(output) {
  const entries = output.split('\0').filter(Boolean);
  const dirtyFiles = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const status = entry.slice(0, 2);
    const relativePath = entry.slice(3);
    if (status === '??') {
      continue;
    }
    dirtyFiles.push(validateTrackedRelativePath(relativePath));
    if (status[0] === 'R' || status[0] === 'C') {
      index += 1;
    }
  }
  return [...new Set(dirtyFiles)].sort();
}

function getExtensionArchiveFiles(trackedFiles) {
  const files = [...trackedFiles]
    .filter((relativePath) => (
      relativePath === 'extension/manifest.json' ||
      relativePath === 'extension/popup.html' ||
      relativePath.startsWith('extension/src/') ||
      relativePath.startsWith('extension/styles/') ||
      relativePath.startsWith('extension/assets/')
    ))
    .map((relativePath) => relativePath.slice('extension/'.length))
    .sort();

  for (const requiredFile of ['manifest.json', 'popup.html']) {
    if (!files.includes(requiredFile)) {
      throw new Error(`Required extension release file is not git-tracked: extension/${requiredFile}`);
    }
  }
  return files;
}

function getNativeTarballFiles(trackedFiles) {
  const files = [
    'package.json',
    'install.sh',
    'scripts/codex-json-agent.mjs',
    'scripts/uninstall-native-host.mjs',
    ...[...trackedFiles].filter((relativePath) => (
      relativePath.startsWith('native-host/src/') ||
      relativePath.startsWith('extension/src/shared/')
    ))
  ];
  return [...new Set(files.map(validateTrackedRelativePath))].sort();
}

function copyTrackedFile({ rootDir, stagingRoot, relativePath, trackedFiles }) {
  const validatedRelativePath = validateTrackedRelativePath(relativePath);
  if (!trackedFiles.has(validatedRelativePath)) {
    throw new Error(`Required release file is not git-tracked: ${validatedRelativePath}`);
  }
  copyFile(path.join(rootDir, validatedRelativePath), path.join(stagingRoot, validatedRelativePath));
}

function validateTrackedRelativePath(relativePath) {
  if (
    !relativePath ||
    path.isAbsolute(relativePath) ||
    relativePath.includes('\0') ||
    relativePath.split('/').includes('..')
  ) {
    throw new Error(`Invalid git-tracked release path: ${relativePath}`);
  }
  return relativePath;
}

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  fs.chmodSync(target, fs.statSync(source).mode & 0o777);
}

function writeVersionPinnedInstallScript({ sourcePath, targetPath, version }) {
  const releaseRef = `v${version}`;
  const source = fs.readFileSync(sourcePath, 'utf8');
  const patched = source.replace(
    'REF="${CODEX_OVERLEAF_REF:-main}"',
    `REF="\${CODEX_OVERLEAF_REF:-${releaseRef}}"`
  );
  if (patched === source) {
    throw new Error('Unable to pin release install.sh default ref.');
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, patched, 'utf8');
  fs.chmodSync(targetPath, fs.statSync(sourcePath).mode & 0o777);
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
