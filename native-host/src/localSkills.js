'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getProjectMirror } = require('./mirrorWorkspace');
const { getHomeDir } = require('./nativeHostPlatform');
const { truncateText } = require('./debugLog');

const SKILLS_DIR = path.join('.codex-overleaf', 'skills');
const CODEX_OVERLEAF_SKILLS_DIR = path.join('.codex-overleaf', 'skills');
const MAX_SKILL_CONTENT_CHARS = 64 * 1024;
const MAX_SKILL_PREVIEW_CHARS = 240;
const PROJECT_SKILL_SCOPE = 'project';
const CODEX_OVERLEAF_SKILL_SCOPE = 'codex-overleaf';

function listProjectSkills({ projectId, rootDir } = {}) {
  const skillsDir = getProjectSkillsDir(projectId, { rootDir });
  if (!fs.existsSync(skillsDir)) {
    return { skills: [] };
  }

  const skills = [];
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) {
      continue;
    }
    const id = entry.name.slice(0, -3);
    if (!isSafeSkillId(id)) {
      continue;
    }
    const filePath = resolveSkillPath(projectId, id, { rootDir });
    const stat = fs.statSync(filePath);
    const content = fs.readFileSync(filePath, 'utf8');
    const title = inferSkillTitle(content) || id;
    skills.push({
      id,
      title,
      name: title,
      scope: PROJECT_SKILL_SCOPE,
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
      preview: buildSkillPreview(content)
    });
  }

  return { skills: skills.sort((left, right) => left.id.localeCompare(right.id)) };
}

function installProjectSkill({ projectId, skillId, content, rootDir } = {}) {
  const id = validateSkillId(skillId);
  if (typeof content !== 'string') {
    throw new Error('Project-local skills require markdown/text content');
  }
  if (content.length > MAX_SKILL_CONTENT_CHARS) {
    throw new Error(`Project-local skill content exceeds ${MAX_SKILL_CONTENT_CHARS} characters`);
  }
  if (content.includes('\u0000')) {
    throw new Error('Project-local skill content must be markdown/text');
  }

  const filePath = resolveSkillPath(projectId, id, { rootDir });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');

  const stat = fs.statSync(filePath);
  const title = inferSkillTitle(content) || id;
  return {
    id,
    title,
    name: title,
    scope: PROJECT_SKILL_SCOPE,
    size: stat.size,
    updatedAt: stat.mtime.toISOString(),
    preview: buildSkillPreview(content)
  };
}

function removeProjectSkill({ projectId, skillId, rootDir } = {}) {
  const id = validateSkillId(skillId);
  const filePath = resolveSkillPath(projectId, id, { rootDir });
  const removed = fs.existsSync(filePath);
  if (removed) {
    fs.rmSync(filePath, { force: true });
  }
  return { id, removed };
}

function listCodexOverleafSkills({ env = process.env, skillsRoot } = {}) {
  const root = getCodexOverleafSkillsRoot({ env, skillsRoot });
  if (!fs.existsSync(root)) {
    return { skills: [] };
  }

  const skills = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !isSafeSkillId(entry.name)) {
      continue;
    }
    const filePath = resolveCodexOverleafSkillPath(entry.name, { env, skillsRoot });
    if (!fs.existsSync(filePath)) {
      continue;
    }
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      continue;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    skills.push(buildSkillMetadata({
      id: entry.name,
      content,
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
      scope: CODEX_OVERLEAF_SKILL_SCOPE
    }));
  }

  return { skills: skills.sort((left, right) => left.id.localeCompare(right.id)) };
}

function installCodexOverleafSkill({ skillId, content, env = process.env, skillsRoot } = {}) {
  const id = validateSkillId(skillId);
  validateSkillContent(content, 'Codex Overleaf skills');

  const filePath = resolveCodexOverleafSkillPath(id, { env, skillsRoot });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');

  const stat = fs.statSync(filePath);
  return buildSkillMetadata({
    id,
    content,
    size: stat.size,
    updatedAt: stat.mtime.toISOString(),
    scope: CODEX_OVERLEAF_SKILL_SCOPE
  });
}

function removeCodexOverleafSkill({ skillId, env = process.env, skillsRoot } = {}) {
  const id = validateSkillId(skillId);
  const root = getCodexOverleafSkillsRoot({ env, skillsRoot });
  const skillDir = resolveInside(root, id, 'Unsafe Codex Overleaf skill path');
  const removed = fs.existsSync(skillDir);
  if (removed) {
    fs.rmSync(skillDir, { recursive: true, force: true });
  }
  return { id, scope: CODEX_OVERLEAF_SKILL_SCOPE, removed };
}

function loadSelectedProjectSkills({ projectId, selectedSkillIds, rootDir, projectRoot } = {}) {
  const ids = normalizeSelectedSkillIds(selectedSkillIds);
  const skills = [];
  const missing = [];

  for (const id of ids) {
    const filePath = resolveSkillPath(projectId, id, { rootDir, projectRoot });
    if (!fs.existsSync(filePath)) {
      missing.push(id);
      continue;
    }
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_SKILL_CONTENT_CHARS * 4) {
      missing.push(id);
      continue;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    skills.push({
      id,
      title: inferSkillTitle(content) || id,
      content: truncateText(content, MAX_SKILL_CONTENT_CHARS)
    });
  }

  return { skills, missing };
}

function normalizeSelectedSkillIds(selectedSkillIds) {
  const seen = new Set();
  const ids = [];
  for (const value of Array.isArray(selectedSkillIds) ? selectedSkillIds : []) {
    const id = validateSkillId(value);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function getProjectSkillsDir(projectId, options = {}) {
  validateProjectId(projectId);
  const mirror = options.projectRoot
    ? { projectRoot: options.projectRoot }
    : getProjectMirror(projectId, options);
  const root = path.resolve(mirror.projectRoot);
  const skillsDir = path.resolve(mirror.projectRoot, SKILLS_DIR);
  if (skillsDir !== root && !skillsDir.startsWith(root + path.sep)) {
    throw new Error('Unsafe project skills path');
  }
  return skillsDir;
}

function getCodexOverleafSkillsRoot({ env = process.env, skillsRoot } = {}) {
  if (skillsRoot) {
    return path.resolve(skillsRoot);
  }
  if (env.CODEX_OVERLEAF_SKILLS_ROOT) {
    return path.resolve(env.CODEX_OVERLEAF_SKILLS_ROOT);
  }
  return path.resolve(getHomeDir({ env }), CODEX_OVERLEAF_SKILLS_DIR);
}

function resolveSkillPath(projectId, skillId, options = {}) {
  const id = validateSkillId(skillId);
  const skillsDir = getProjectSkillsDir(projectId, options);
  const target = path.resolve(skillsDir, `${id}.md`);
  if (target !== skillsDir && !target.startsWith(skillsDir + path.sep)) {
    throw new Error('Unsafe project skill path');
  }
  return target;
}

function resolveCodexOverleafSkillPath(skillId, options = {}) {
  const id = validateSkillId(skillId);
  const root = getCodexOverleafSkillsRoot(options);
  const skillDir = resolveInside(root, id, 'Unsafe Codex Overleaf skill path');
  return resolveInside(skillDir, 'SKILL.md', 'Unsafe Codex Overleaf skill path');
}

function resolveInside(root, child, message) {
  const base = path.resolve(root);
  const target = path.resolve(base, child);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error(message);
  }
  return target;
}

function validateProjectId(projectId) {
  if (typeof projectId !== 'string' || !projectId.trim()) {
    throw new Error('Project id is required');
  }
  if (projectId.length > 512) {
    throw new Error('Project id is too long');
  }
}

function validateSkillId(skillId) {
  const id = String(skillId || '').trim();
  if (!isSafeSkillId(id)) {
    throw new Error('Invalid skill id');
  }
  return id;
}

function validateSkillContent(content, label) {
  if (typeof content !== 'string') {
    throw new Error(`${label} require markdown/text content`);
  }
  if (content.length > MAX_SKILL_CONTENT_CHARS) {
    throw new Error(`${label} content exceeds ${MAX_SKILL_CONTENT_CHARS} characters`);
  }
  if (content.includes('\u0000')) {
    throw new Error(`${label} content must be markdown/text`);
  }
}

function isSafeSkillId(id) {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(String(id || ''))
    && !String(id).includes('..');
}

function inferSkillTitle(content) {
  for (const line of String(content || '').split(/\r?\n/)) {
    const heading = /^#\s+(.+?)\s*$/.exec(line);
    if (heading) {
      return truncateText(heading[1].trim(), 120);
    }
  }
  for (const line of String(content || '').split(/\r?\n/)) {
    const clean = line.trim();
    if (clean) {
      return truncateText(clean.replace(/^#+\s*/, ''), 120);
    }
  }
  return '';
}

function buildSkillPreview(content) {
  return truncateText(
    String(content || '')
      .replace(/^#\s+.*(?:\r?\n)+/, '')
      .replace(/\s+/g, ' ')
      .trim(),
    MAX_SKILL_PREVIEW_CHARS
  );
}

function buildSkillMetadata({ id, content, size, updatedAt, scope }) {
  const title = inferSkillTitle(content) || id;
  return {
    id,
    title,
    name: title,
    scope,
    size,
    updatedAt,
    preview: buildSkillPreview(content)
  };
}

module.exports = {
  CODEX_OVERLEAF_SKILL_SCOPE,
  MAX_SKILL_CONTENT_CHARS,
  PROJECT_SKILL_SCOPE,
  getCodexOverleafSkillsRoot,
  installCodexOverleafSkill,
  installProjectSkill,
  listCodexOverleafSkills,
  listProjectSkills,
  loadSelectedProjectSkills,
  removeCodexOverleafSkill,
  removeProjectSkill
};
