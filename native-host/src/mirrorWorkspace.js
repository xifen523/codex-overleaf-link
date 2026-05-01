'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ROOT = path.join(process.env.HOME || process.cwd(), '.codex-overleaf', 'projects');
const BASELINE_FILE = 'baseline.json';

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
  const files = normalizeProjectFiles(project?.files || []);
  const nextPaths = new Set(files.map(file => file.path));
  const previous = readBaseline(mirror.baselinePath);

  fs.mkdirSync(mirror.workspacePath, { recursive: true });
  fs.mkdirSync(mirror.metadataPath, { recursive: true });

  for (const file of previous.files || []) {
    if (nextPaths.has(file.path)) {
      continue;
    }
    const target = resolveWorkspacePath(mirror.workspacePath, file.path);
    if (fs.existsSync(target)) {
      fs.rmSync(target, { force: true });
      removeEmptyParents(path.dirname(target), mirror.workspacePath);
    }
  }

  for (const file of files) {
    const target = resolveWorkspacePath(mirror.workspacePath, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.content, 'utf8');
  }

  writeBaseline(mirror.baselinePath, {
    projectKey: mirror.projectKey,
    capturedAt: new Date().toISOString(),
    files: files.map(file => ({
      path: file.path,
      content: file.content,
      hash: hashText(file.content)
    }))
  });

  return {
    ...mirror,
    fileCount: files.length
  };
}

async function collectMirrorChanges({ projectId, rootDir }) {
  const mirror = getProjectMirror(projectId, { rootDir });
  const baseline = readBaseline(mirror.baselinePath);
  const baselineByPath = new Map((baseline.files || []).map(file => [file.path, file]));
  const currentPaths = listWorkspaceFiles(mirror.workspacePath);
  const currentByPath = new Map();

  for (const filePath of currentPaths) {
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
        previousContent: previous?.content || ''
      });
    }
  }

  for (const [filePath, previous] of baselineByPath) {
    if (!currentByPath.has(filePath)) {
      changes.push({
        type: 'delete',
        path: filePath,
        previousContent: previous.content || ''
      });
    }
  }

  return changes.sort(compareSyncChanges);
}

function normalizeProjectFiles(files) {
  return files
    .filter(file => file && typeof file.path === 'string' && typeof file.content === 'string')
    .map(file => ({
      path: normalizeRelativePath(file.path),
      content: file.content
    }));
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

function hashText(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

module.exports = {
  collectMirrorChanges,
  getProjectMirror,
  syncOverleafToMirror
};
