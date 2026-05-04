'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ROOT = path.join(process.env.HOME || process.cwd(), '.codex-overleaf', 'projects');
const BASELINE_FILE = 'baseline.json';
const MAX_BINARY_FILE_BYTES = 10 * 1024 * 1024;

function getProjectMirror(projectId, options = {}) {
  const rootDir = path.resolve(options.rootDir || DEFAULT_ROOT);
  const projectKey = normalizeProjectKey(projectId);
  const projectRoot = path.join(rootDir, projectKey);
  return {
    projectKey,
    projectRoot,
    workspacePath: path.join(projectRoot, 'workspace'),
    metadataPath: path.join(projectRoot, 'metadata'),
    baselinePath: path.join(projectRoot, 'metadata', BASELINE_FILE)
  };
}

async function syncOverleafToMirror({ projectId, project, rootDir }) {
  const mirror = getProjectMirror(projectId, { rootDir });
  const normalized = normalizeProjectFilesDetailed(project?.files || []);
  const files = normalized.files;
  const skippedFiles = normalized.skippedFiles;
  const nextPaths = new Set(files.map(file => file.path));
  const previous = readBaseline(mirror.baselinePath);
  const fullProjectSnapshot = project?.capabilities?.fullProjectSnapshot !== false;

  fs.mkdirSync(mirror.workspacePath, { recursive: true });
  fs.mkdirSync(mirror.metadataPath, { recursive: true });

  if (fullProjectSnapshot) {
    for (const filePath of listWorkspaceFiles(mirror.workspacePath)) {
      if (nextPaths.has(filePath)) {
        continue;
      }
      const target = resolveWorkspacePath(mirror.workspacePath, filePath);
      if (fs.existsSync(target)) {
        fs.rmSync(target, { force: true });
        removeEmptyParents(path.dirname(target), mirror.workspacePath);
      }
    }
  }

  let writtenCount = 0;
  const previousByPath = new Map((previous.files || []).map(f => [f.path, f]));

  for (const file of files) {
    const target = resolveWorkspacePath(mirror.workspacePath, file.path);
    const prev = previousByPath.get(file.path);
    const nextHash = hashProjectFile(file);
    if (prev && prev.hash === nextHash && workspaceFileMatchesBaseline(target, prev)) {
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    writeProjectFile(target, file);
    writtenCount++;
  }

  const now = new Date().toISOString();
  const nextBaselineFiles = fullProjectSnapshot
    ? files.map(file => buildBaselineFile(file))
    : mergePartialBaselineFiles(previous.files || [], files);

  writeBaseline(mirror.baselinePath, {
    ...previous,
    projectKey: mirror.projectKey,
    capturedAt: fullProjectSnapshot ? now : (previous.capturedAt || ''),
    lastFullSyncAt: fullProjectSnapshot ? now : previous.lastFullSyncAt,
    lastPartialSyncAt: fullProjectSnapshot ? previous.lastPartialSyncAt : now,
    lastSyncSource: fullProjectSnapshot ? (project?.capabilities?.method || 'snapshot') : previous.lastSyncSource,
    lastFileCount: files.length,
    dirty: fullProjectSnapshot ? false : previous.dirty === true,
    dirtyReason: fullProjectSnapshot ? '' : previous.dirtyReason || '',
    dirtyAt: fullProjectSnapshot ? '' : previous.dirtyAt || '',
    files: nextBaselineFiles
  });

  return {
    ...mirror,
    fileCount: files.length,
    writtenCount,
    skippedFiles,
    partialSnapshot: !fullProjectSnapshot
  };
}

async function collectMirrorChanges({ projectId, rootDir }) {
  return (await collectMirrorChangesDetailed({ projectId, rootDir })).changes;
}

async function collectMirrorChangesDetailed({ projectId, rootDir }) {
  const mirror = getProjectMirror(projectId, { rootDir });
  const baseline = readBaseline(mirror.baselinePath);
  const baselineByPath = new Map((baseline.files || []).map(file => [file.path, file]));
  const currentPaths = listWorkspaceFiles(mirror.workspacePath);
  const currentByPath = new Map();
  const unsupportedChanges = [];

  for (const filePath of currentPaths) {
    const previous = baselineByPath.get(filePath);
    if (previous?.kind === 'binary') {
      continue;
    }
    if (!previous && isGeneratedArtifactPath(filePath)) {
      unsupportedChanges.push({
        type: 'unsupported-local-file',
        path: filePath,
        reason: 'generated_artifact'
      });
      continue;
    }
    if (!previous && !isTextMirrorPath(filePath)) {
      unsupportedChanges.push({
        type: 'unsupported-local-file',
        path: filePath,
        reason: 'unsupported_non_text_file'
      });
      continue;
    }
    const content = fs.readFileSync(resolveWorkspacePath(mirror.workspacePath, filePath), 'utf8');
    currentByPath.set(filePath, content);
  }

  const changes = [];
  for (const [filePath, content] of currentByPath) {
    const previous = baselineByPath.get(filePath);
    if (!previous || previous.content !== content) {
      changes.push({
        type: 'write',
        path: filePath,
        content,
        previousContent: previous?.content || '',
        previousExists: Boolean(previous)
      });
    }
  }

  for (const [filePath, previous] of baselineByPath) {
    if (previous.kind === 'binary') {
      continue;
    }
    if (!currentByPath.has(filePath)) {
      changes.push({
        type: 'delete',
        path: filePath,
        previousContent: previous.content || '',
        previousExists: true
      });
    }
  }

  return {
    changes: changes.sort(compareSyncChanges),
    unsupportedChanges: unsupportedChanges.sort((left, right) => left.path.localeCompare(right.path))
  };
}

function normalizeProjectFiles(files) {
  return normalizeProjectFilesDetailed(files).files;
}

function normalizeProjectFilesDetailed(files) {
  const normalized = [];
  const skippedFiles = [];
  for (const file of files) {
    const result = normalizeProjectFile(file);
    if (result?.file) {
      normalized.push(result.file);
    } else if (result?.skipped) {
      skippedFiles.push(result.skipped);
    }
  }
  return {
    files: normalized,
    skippedFiles
  };
}

function normalizeProjectFile(file) {
  if (!file || typeof file.path !== 'string') {
    return null;
  }
  const normalizedPath = normalizeRelativePath(file.path);
  if (typeof file.content === 'string') {
    return {
      file: {
        path: normalizedPath,
        kind: 'text',
        content: file.content
      }
    };
  }
  if (typeof file.contentBase64 === 'string') {
    const size = Number.isFinite(Number(file.size)) ? Number(file.size) : estimateBase64Size(file.contentBase64);
    if (size > MAX_BINARY_FILE_BYTES) {
      return {
        skipped: {
          path: normalizedPath,
          kind: 'binary',
          size,
          reason: 'binary_file_too_large'
        }
      };
    }
    return {
      file: {
        path: normalizedPath,
        kind: 'binary',
        contentBase64: file.contentBase64,
        size
      }
    };
  }
  return null;
}

function estimateBase64Size(value) {
  const clean = String(value || '').replace(/\s+/g, '');
  if (!clean) {
    return 0;
  }
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(clean.length * 3 / 4) - padding);
}

function writeProjectFile(target, file) {
  if (file.kind === 'binary') {
    fs.writeFileSync(target, decodeBase64File(file.contentBase64));
    return;
  }
  fs.writeFileSync(target, file.content, 'utf8');
}

function buildBaselineFile(file) {
  const baseline = {
    path: file.path,
    kind: file.kind,
    hash: hashProjectFile(file)
  };
  if (file.kind === 'binary') {
    baseline.size = file.size;
  } else {
    baseline.content = file.content;
  }
  return baseline;
}

function workspaceFileMatchesBaseline(target, baselineFile = {}) {
  if (!fs.existsSync(target)) {
    return false;
  }
  if (baselineFile.kind === 'binary') {
    return hashBytes(fs.readFileSync(target)) === baselineFile.hash;
  }
  return hashText(fs.readFileSync(target, 'utf8')) === baselineFile.hash;
}

function mergePartialBaselineFiles(previousFiles, overlayFiles) {
  const filesByPath = new Map((previousFiles || []).map(file => [file.path, file]));
  for (const file of overlayFiles || []) {
    filesByPath.set(file.path, buildBaselineFile(file));
  }
  return Array.from(filesByPath.values()).sort((left, right) => left.path.localeCompare(right.path));
}

function hashProjectFile(file) {
  return hashBytes(getProjectFileBytes(file));
}

function getProjectFileBytes(file) {
  if (file.kind === 'binary') {
    return decodeBase64File(file.contentBase64);
  }
  return Buffer.from(String(file.content || ''), 'utf8');
}

function decodeBase64File(contentBase64) {
  return Buffer.from(String(contentBase64 || ''), 'base64');
}

function normalizeProjectKey(projectId) {
  const raw = String(projectId || '').trim();
  const fromProjectUrl = raw.match(/\/project\/([^/?#]+)/)?.[1];
  const candidate = fromProjectUrl || raw.split(/[/?#]/).filter(Boolean).pop() || 'unknown-project';
  const safe = candidate.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+|-+$/g, '');
  if (safe) {
    return safe.slice(0, 80);
  }
  return hashText(raw || 'unknown-project').slice(0, 16);
}

function normalizeRelativePath(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some(part => part === '..' || part === '.')) {
    throw new Error(`Unsafe project path: ${filePath}`);
  }
  return normalized;
}

function resolveWorkspacePath(workspacePath, filePath) {
  const relative = normalizeRelativePath(filePath);
  const target = path.resolve(workspacePath, relative);
  const root = path.resolve(workspacePath);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`Unsafe project path: ${filePath}`);
  }
  return target;
}

function listWorkspaceFiles(workspacePath) {
  if (!fs.existsSync(workspacePath)) {
    return [];
  }
  const files = [];
  walk(workspacePath, '');
  return files.sort();

  function walk(dir, prefix) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.DS_Store') {
        continue;
      }
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute, relative);
      } else if (entry.isFile()) {
        files.push(normalizeRelativePath(relative));
      }
    }
  }
}

function readBaseline(baselinePath) {
  try {
    return JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  } catch {
    return { files: [] };
  }
}

function writeBaseline(baselinePath, baseline) {
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2), 'utf8');
}

function removeEmptyParents(startDir, stopDir) {
  let current = startDir;
  const stop = path.resolve(stopDir);
  while (current.startsWith(stop) && current !== stop) {
    try {
      fs.rmdirSync(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

function compareSyncChanges(left, right) {
  if (left.type !== right.type) {
    return left.type === 'write' ? -1 : 1;
  }
  return left.path.localeCompare(right.path);
}

function isGeneratedArtifactPath(filePath) {
  const normalized = normalizeRelativePath(filePath).toLowerCase();
  const basename = path.posix.basename(normalized);
  if (/^(?:\.|__latexindent_temp)/.test(basename)) {
    return true;
  }
  return /\.(aux|bbl|bcf|blg|brf|fdb_latexmk|fls|lof|log|lot|out|pdf|run\.xml|synctex(?:\.gz)?|toc|xdv)$/i.test(normalized);
}

function isTextMirrorPath(filePath) {
  const normalized = normalizeRelativePath(filePath).toLowerCase();
  const basename = path.posix.basename(normalized);
  if (basename === '.latexmkrc') {
    return true;
  }
  return /\.(tex|bib|bst|cls|sty|clo|cfg|def|bbx|cbx|lbx|ist|tikz|pgf|asy|txt|md|csv|tsv|dat|json|ya?ml|py|r|m|sh)$/i.test(normalized);
}

function hashText(text) {
  return hashBytes(Buffer.from(String(text || ''), 'utf8'));
}

function hashBytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function getMirrorStatus(projectId, options = {}) {
  const mirror = getProjectMirror(projectId, options);
  const baseline = readBaseline(mirror.baselinePath);
  if (!baseline.lastFullSyncAt) {
    return {
      exists: false,
      projectKey: mirror.projectKey,
      fileCount: 0,
      ageMs: Infinity,
      baselineCapturedAt: baseline.capturedAt || '',
      lastFullSyncAt: '',
      lastPartialSyncAt: baseline.lastPartialSyncAt || '',
      lastSyncSource: baseline.lastSyncSource || '',
      lastFileCount: Number.isFinite(Number(baseline.lastFileCount)) ? Number(baseline.lastFileCount) : (baseline.files || []).length,
      dirty: baseline.dirty === true,
      dirtyReason: baseline.dirtyReason || '',
      workspacePath: mirror.workspacePath
    };
  }
  if (baseline.dirty === true) {
    return {
      exists: false,
      projectKey: mirror.projectKey,
      fileCount: 0,
      ageMs: Infinity,
      baselineCapturedAt: baseline.capturedAt || baseline.lastFullSyncAt || '',
      lastFullSyncAt: '',
      lastPartialSyncAt: baseline.lastPartialSyncAt || '',
      lastSyncSource: baseline.lastSyncSource || '',
      lastFileCount: Number.isFinite(Number(baseline.lastFileCount)) ? Number(baseline.lastFileCount) : (baseline.files || []).length,
      dirty: true,
      dirtyReason: baseline.dirtyReason || 'dirty_mirror',
      workspacePath: mirror.workspacePath
    };
  }
  const lastFullSyncAt = baseline.lastFullSyncAt;
  const lastFullSyncTime = new Date(lastFullSyncAt).getTime();
  if (!Number.isFinite(lastFullSyncTime)) {
    return {
      exists: false,
      projectKey: mirror.projectKey,
      fileCount: 0,
      ageMs: Infinity,
      baselineCapturedAt: lastFullSyncAt,
      lastFullSyncAt: '',
      lastPartialSyncAt: baseline.lastPartialSyncAt || '',
      lastSyncSource: baseline.lastSyncSource || '',
      lastFileCount: Number.isFinite(Number(baseline.lastFileCount)) ? Number(baseline.lastFileCount) : (baseline.files || []).length,
      dirty: false,
      dirtyReason: '',
      workspacePath: mirror.workspacePath
    };
  }
  const integrity = verifyWorkspaceMatchesBaseline(mirror.workspacePath, baseline.files || []);
  if (!integrity.ok) {
    return {
      exists: false,
      projectKey: mirror.projectKey,
      fileCount: 0,
      ageMs: Infinity,
      baselineCapturedAt: lastFullSyncAt,
      lastFullSyncAt: '',
      lastPartialSyncAt: baseline.lastPartialSyncAt || '',
      lastSyncSource: baseline.lastSyncSource || '',
      lastFileCount: Number.isFinite(Number(baseline.lastFileCount)) ? Number(baseline.lastFileCount) : (baseline.files || []).length,
      dirty: true,
      dirtyReason: integrity.reason,
      dirtyPath: integrity.path || '',
      workspacePath: mirror.workspacePath
    };
  }
  const ageMs = Date.now() - lastFullSyncTime;
  return {
    exists: true,
    projectKey: mirror.projectKey,
    fileCount: (baseline.files || []).length,
    ageMs: Math.max(0, ageMs),
    baselineCapturedAt: lastFullSyncAt,
    lastFullSyncAt,
    lastPartialSyncAt: baseline.lastPartialSyncAt || '',
    lastSyncSource: baseline.lastSyncSource || '',
    lastFileCount: Number.isFinite(Number(baseline.lastFileCount)) ? Number(baseline.lastFileCount) : (baseline.files || []).length,
    dirty: false,
    dirtyReason: '',
    workspacePath: mirror.workspacePath
  };
}

async function applyFileOverlays({ projectId, overlays, rootDir }) {
  const mirror = getProjectMirror(projectId, { rootDir });
  const baseline = readBaseline(mirror.baselinePath);
  const filesByPath = new Map((baseline.files || []).map(f => [f.path, f]));

  for (const overlay of overlays || []) {
    if (!overlay?.path || typeof overlay.content !== 'string') {
      continue;
    }
    const normalizedPath = normalizeRelativePath(overlay.path);
    const target = resolveWorkspacePath(mirror.workspacePath, normalizedPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, overlay.content, 'utf8');

    filesByPath.set(normalizedPath, {
      path: normalizedPath,
      kind: 'text',
      hash: overlay.hash || hashText(overlay.content),
      content: overlay.content
    });
  }

  // Write baseline preserving lastFullSyncAt unchanged
  writeBaseline(mirror.baselinePath, {
    ...baseline,
    files: Array.from(filesByPath.values())
  });
}

function markMirrorDirty({ projectId, rootDir, reason = 'dirty_mirror' }) {
  const mirror = getProjectMirror(projectId, { rootDir });
  const baseline = readBaseline(mirror.baselinePath);
  writeBaseline(mirror.baselinePath, {
    ...baseline,
    projectKey: mirror.projectKey,
    dirty: true,
    dirtyReason: reason,
    dirtyAt: new Date().toISOString()
  });
}

function verifyWorkspaceMatchesBaseline(workspacePath, baselineFiles = []) {
  const baselinePaths = new Set();
  for (const file of baselineFiles || []) {
    if (!file?.path) {
      continue;
    }
    baselinePaths.add(file.path);
    const target = resolveWorkspacePath(workspacePath, file.path);
    if (!fs.existsSync(target)) {
      return { ok: false, reason: 'workspace_mismatch', path: file.path };
    }
    if (file.kind === 'binary') {
      if (hashBytes(fs.readFileSync(target)) !== file.hash) {
        return { ok: false, reason: 'workspace_mismatch', path: file.path };
      }
      continue;
    }
    const content = fs.readFileSync(target, 'utf8');
    if (hashText(content) !== file.hash) {
      return { ok: false, reason: 'workspace_mismatch', path: file.path };
    }
  }
  for (const filePath of listWorkspaceFiles(workspacePath)) {
    if (baselinePaths.has(filePath)) {
      continue;
    }
    if (isTextMirrorPath(filePath) && !isGeneratedArtifactPath(filePath)) {
      return { ok: false, reason: 'workspace_extra_file', path: filePath };
    }
  }
  return { ok: true };
}

module.exports = {
  applyFileOverlays,
  collectMirrorChangesDetailed,
  collectMirrorChanges,
  getMirrorStatus,
  getProjectMirror,
  markMirrorDirty,
  syncOverleafToMirror
};
