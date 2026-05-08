'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getDefaultRuntimeRoot } = require('./nativeHostPlatform');

const MANAGED_BY = 'codex-overleaf-link';
const MARKER_FILE = '.codex-overleaf-runtime.json';
const DEFAULT_RUNTIME_ROOT = getDefaultRuntimeRoot();

function buildRuntimeFileManifest(options = {}) {
  const packageRoot = path.resolve(options.packageRoot || getDefaultPackageRoot());
  const files = [
    fileEntry(packageRoot, 'package.json'),
    ...directoryEntries(packageRoot, 'native-host/src'),
    ...directoryEntries(packageRoot, 'extension/src/shared'),
    fileEntry(packageRoot, 'scripts/codex-json-agent.mjs'),
    fileEntry(packageRoot, 'scripts/install-native-host.mjs'),
    fileEntry(packageRoot, 'scripts/uninstall-native-host.mjs')
  ];

  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function assertSafeManagedRuntimeRoot(runtimeRoot, options = {}) {
  if (!runtimeRoot || typeof runtimeRoot !== 'string') {
    throw new Error('Runtime root is required');
  }

  const platformPath = options.platformPath || path;
  const resolvedRoot = platformPath.resolve(runtimeRoot);
  const homeDir = platformPath.resolve(options.homeDir || os.homedir());
  const repoRoot = platformPath.resolve(options.packageRoot || getDefaultPackageRoot());
  const defaultRoot = platformPath.resolve(options.defaultRuntimeRoot || DEFAULT_RUNTIME_ROOT);
  const broadSystemDirs = getBroadSystemDirs(platformPath, options);

  if (samePath(resolvedRoot, platformPath.parse(resolvedRoot).root, platformPath)) {
    throwUnsafe(runtimeRoot);
  }
  if (samePath(resolvedRoot, homeDir, platformPath)) {
    throwUnsafe(runtimeRoot);
  }
  if (samePath(resolvedRoot, repoRoot, platformPath)) {
    throwUnsafe(runtimeRoot);
  }
  for (const systemDir of broadSystemDirs) {
    if (samePath(resolvedRoot, systemDir, platformPath)) {
      throwUnsafe(runtimeRoot);
    }
  }

  if (samePath(resolvedRoot, defaultRoot, platformPath)) {
    return resolvedRoot;
  }

  const baseName = platformPath.basename(resolvedRoot);
  const allowedTempRuntimeNames = new Set(['runtime', 'native-host-runtime', 'codex-overleaf-runtime']);
  if (allowedTempRuntimeNames.has(baseName) && isUnderHostTempDir(resolvedRoot, platformPath)) {
    return resolvedRoot;
  }

  throwUnsafe(runtimeRoot);
}

function installRuntimeFromPackage(options = {}) {
  const packageRoot = path.resolve(options.packageRoot || getDefaultPackageRoot());
  const runtimeRootInput = options.runtimeRoot || DEFAULT_RUNTIME_ROOT;
  assertSafeManagedRuntimeRoot(runtimeRootInput, { ...options, packageRoot });
  const runtimeRoot = path.resolve(runtimeRootInput);

  const existingMarker = readRuntimeMarker(runtimeRoot);
  if (fs.existsSync(runtimeRoot) && !isManagedMarker(existingMarker)) {
    throw new Error(`Refusing to replace unmarked runtime root: ${runtimeRoot}`);
  }

  const parentDir = path.dirname(runtimeRoot);
  fs.mkdirSync(parentDir, { recursive: true });
  const unique = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const stagingRoot = path.join(parentDir, `.${path.basename(runtimeRoot)}.staging-${unique}`);
  const rollbackRoot = path.join(parentDir, `.${path.basename(runtimeRoot)}.rollback-${unique}`);

  try {
    copyRuntimeFiles(packageRoot, stagingRoot);
    writeRuntimeMarker(stagingRoot, packageRoot);
    verifyInstalledRuntime(stagingRoot, options.verifyRuntime);

    let rollbackCreated = false;
    if (fs.existsSync(runtimeRoot)) {
      fs.renameSync(runtimeRoot, rollbackRoot);
      rollbackCreated = true;
    }

    try {
      fs.renameSync(stagingRoot, runtimeRoot);
    } catch (error) {
      if (rollbackCreated && !fs.existsSync(runtimeRoot) && fs.existsSync(rollbackRoot)) {
        fs.renameSync(rollbackRoot, runtimeRoot);
      }
      throw error;
    }

    let warning;
    if (rollbackCreated) {
      try {
        cleanupRollback(rollbackRoot, options.cleanupRollback);
      } catch (error) {
        warning = `Installed runtime, but failed to remove rollback directory ${rollbackRoot}: ${error.message}`;
      }
    }

    return {
      ok: true,
      action: existingMarker ? 'replaced' : 'installed',
      runtimeRoot,
      marker: readRuntimeMarker(runtimeRoot),
      warning
    };
  } catch (error) {
    safeRemove(stagingRoot);
    throw error;
  }
}

function uninstallManagedRuntime(options = {}) {
  const runtimeRootInput = options.runtimeRoot || DEFAULT_RUNTIME_ROOT;
  assertSafeManagedRuntimeRoot(runtimeRootInput, options);
  const runtimeRoot = path.resolve(runtimeRootInput);

  if (!fs.existsSync(runtimeRoot)) {
    return { ok: true, action: 'not-found', runtimeRoot, removed: false, kept: false };
  }

  const marker = readRuntimeMarker(runtimeRoot);
  if (!isManagedMarker(marker)) {
    throw new Error(`Refusing to remove unmarked runtime root: ${runtimeRoot}`);
  }

  if (options.keepRuntime) {
    return { ok: true, action: 'kept', runtimeRoot, removed: false, kept: true, marker };
  }

  fs.rmSync(runtimeRoot, { recursive: true, force: true });
  return { ok: true, action: 'removed', runtimeRoot, removed: true, kept: false, marker };
}

function readRuntimeMarker(runtimeRoot) {
  const markerPath = path.join(runtimeRoot, MARKER_FILE);
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    return marker && typeof marker === 'object' ? marker : null;
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.name === 'SyntaxError')) {
      return null;
    }
    throw error;
  }
}

function copyRuntimeFiles(packageRoot, runtimeRoot) {
  for (const entry of buildRuntimeFileManifest({ packageRoot })) {
    copyFile(entry.sourcePath, path.join(runtimeRoot, entry.relativePath));
  }
}

function writeRuntimeMarker(runtimeRoot, packageRoot) {
  const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  const marker = {
    managedBy: MANAGED_BY,
    version: typeof pkg.version === 'string' ? pkg.version : 'unknown',
    installedFrom: 'npm',
    installedAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(runtimeRoot, MARKER_FILE), `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
}

function verifyInstalledRuntime(stagingRoot, verifyRuntime) {
  if (typeof verifyRuntime === 'function') {
    verifyRuntime(stagingRoot);
    return;
  }

  const requiredFiles = [
    'package.json',
    'native-host/src/index.js',
    'scripts/codex-json-agent.mjs'
  ];
  for (const relativePath of requiredFiles) {
    if (!fs.existsSync(path.join(stagingRoot, relativePath))) {
      throw new Error(`Runtime verification failed; missing ${relativePath}`);
    }
  }
}

function fileEntry(packageRoot, relativePath) {
  return {
    relativePath,
    sourcePath: path.join(packageRoot, relativePath)
  };
}

function directoryEntries(packageRoot, relativeDir) {
  const sourceDir = path.join(packageRoot, relativeDir);
  const entries = [];
  for (const dirent of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const childRelativePath = path.posix.join(relativeDir.replace(/\\/g, '/'), dirent.name);
    const childSourcePath = path.join(packageRoot, childRelativePath);
    if (dirent.isDirectory()) {
      entries.push(...directoryEntries(packageRoot, childRelativePath));
    } else if (dirent.isFile()) {
      entries.push({ relativePath: childRelativePath, sourcePath: childSourcePath });
    }
  }
  return entries;
}

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function isManagedMarker(marker) {
  return marker && marker.managedBy === MANAGED_BY;
}

function getDefaultPackageRoot() {
  return path.resolve(__dirname, '../..');
}

function getBroadSystemDirs(platformPath, options = {}) {
  if (platformPath === path.win32) {
    const roots = ['C:\\', 'C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)'];
    return roots.map((value) => platformPath.resolve(value));
  }
  const dirs = ['/', '/bin', '/etc', '/opt', '/private', '/sbin', '/tmp', '/usr', '/usr/local', '/var'];
  if (options.extraUnsafeRoots) {
    dirs.push(...options.extraUnsafeRoots);
  }
  return dirs.map((value) => platformPath.resolve(value));
}

function isUnderHostTempDir(targetRoot, platformPath) {
  if (platformPath === path.win32) {
    return false;
  }

  const tempDir = path.resolve(os.tmpdir());
  const realTempDir = fs.realpathSync(os.tmpdir());
  const parentPath = path.dirname(path.resolve(targetRoot));
  if (parentPath !== tempDir && !parentPath.startsWith(`${tempDir}${path.sep}`)) {
    return false;
  }
  if (!hasNoSymlinkAncestorsBelowTemp(parentPath, tempDir)) {
    return false;
  }

  const existingParent = findExistingAncestor(parentPath);
  if (!existingParent) {
    return false;
  }

  const realParent = fs.realpathSync(existingParent);
  if (realParent === realTempDir || realParent.startsWith(`${realTempDir}${path.sep}`)) {
    return true;
  }
  return false;
}

function findExistingAncestor(targetPath) {
  let current = path.resolve(targetPath);
  while (true) {
    if (fs.existsSync(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function hasNoSymlinkAncestorsBelowTemp(parentPath, tempDir) {
  let current = path.resolve(parentPath);
  const resolvedTempDir = path.resolve(tempDir);
  while (current !== resolvedTempDir) {
    if (fs.existsSync(current)) {
      try {
        if (fs.lstatSync(current).isSymbolicLink()) {
          return false;
        }
      } catch {
        return false;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return false;
    }
    current = parent;
  }
  return true;
}

function samePath(left, right, platformPath) {
  const resolvedLeft = platformPath.resolve(left);
  const resolvedRight = platformPath.resolve(right);
  if (platformPath === path.win32) {
    return resolvedLeft.toLowerCase() === resolvedRight.toLowerCase();
  }
  return resolvedLeft === resolvedRight;
}

function throwUnsafe(runtimeRoot) {
  throw new Error(`Refusing to recursively remove unsafe runtime root: ${runtimeRoot}`);
}

function safeRemove(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function cleanupRollback(rollbackRoot, injectedCleanupRollback) {
  if (typeof injectedCleanupRollback === 'function') {
    injectedCleanupRollback(rollbackRoot);
    return;
  }
  safeRemove(rollbackRoot);
}

module.exports = {
  DEFAULT_RUNTIME_ROOT,
  buildRuntimeFileManifest,
  assertSafeManagedRuntimeRoot,
  installRuntimeFromPackage,
  uninstallManagedRuntime,
  readRuntimeMarker
};
