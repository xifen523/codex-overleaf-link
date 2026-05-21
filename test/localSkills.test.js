const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  ensureCodexOverleafSkillInstalled,
  installCodexOverleafSkill,
  installProjectSkill,
  listCodexOverleafSkills,
  loadSelectedCodexOverleafSkill,
  materializeProjectSkillsAsCodexSkills
} = require('../native-host/src/localSkills');

test('loadSelectedCodexOverleafSkill reads selected Codex Overleaf SKILL.md content', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-local-skills-'));
  const overleafSkillsRoot = path.join(home, '.codex-overleaf', 'skills');
  const env = { HOME: home, CODEX_OVERLEAF_SKILLS_ROOT: overleafSkillsRoot };
  try {
    installCodexOverleafSkill({
      skillId: 'venue-style',
      content: '# Venue Style\n\nPrefer concise claims and preserve citation keys.',
      env
    });

    const result = loadSelectedCodexOverleafSkill({
      skillId: 'venue-style',
      loadCodexOverleafSkills: true,
      env
    });

    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.ignored, []);
    assert.equal(result.skill.id, 'venue-style');
    assert.equal(result.skill.title, 'Venue Style');
    assert.match(result.skill.content, /Prefer concise claims/);
    assert.equal(result.skill.scope, 'codex-overleaf');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('loadSelectedCodexOverleafSkill reports missing selections', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-local-skills-'));
  const overleafSkillsRoot = path.join(home, '.codex-overleaf', 'skills');
  const env = { HOME: home, CODEX_OVERLEAF_SKILLS_ROOT: overleafSkillsRoot };
  try {
    fs.mkdirSync(overleafSkillsRoot, { recursive: true });

    const result = loadSelectedCodexOverleafSkill({
      skillId: 'missing-style',
      loadCodexOverleafSkills: true,
      env
    });

    assert.equal(result.skill, null);
    assert.deepEqual(result.missing, ['missing-style']);
    assert.deepEqual(result.ignored, []);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('loadSelectedCodexOverleafSkill ignores selections when Codex Overleaf skills are disabled', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-local-skills-'));
  const overleafSkillsRoot = path.join(home, '.codex-overleaf', 'skills');
  const env = { HOME: home, CODEX_OVERLEAF_SKILLS_ROOT: overleafSkillsRoot };
  try {
    installCodexOverleafSkill({
      skillId: 'disabled-style',
      content: '# Disabled Style\n\nThis content must not load.',
      env
    });

    const result = loadSelectedCodexOverleafSkill({
      skillId: 'disabled-style',
      loadCodexOverleafSkills: false,
      env
    });

    assert.equal(result.skill, null);
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.ignored, [{
      id: 'disabled-style',
      reason: 'codex_overleaf_skills_disabled'
    }]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('materializeProjectSkillsAsCodexSkills exposes project-local skills as Codex registry skills', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-project-skills-'));
  const targetRoot = path.join(rootDir, 'codex-home', 'skills');
  try {
    installProjectSkill({
      projectId: 'project-auto-skills',
      skillId: 'paper-style',
      content: '# Paper Style\n\nUse this automatically when a writing task matches.',
      rootDir
    });

    const result = materializeProjectSkillsAsCodexSkills({
      projectId: 'project-auto-skills',
      rootDir,
      targetRoot
    });

    assert.deepEqual(result.installed, ['paper-style']);
    assert.deepEqual(result.skipped, []);
    assert.match(
      fs.readFileSync(path.join(targetRoot, 'paper-style', 'SKILL.md'), 'utf8'),
      /Use this automatically/
    );
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('ensureCodexOverleafSkillInstalled writes SKILL.md when absent', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-ensure-skill-'));
  const overleafSkillsRoot = path.join(home, '.codex-overleaf', 'skills');
  const env = { HOME: home, CODEX_OVERLEAF_SKILLS_ROOT: overleafSkillsRoot };
  const content = '# Test Skill\n\nTest content.';
  try {
    ensureCodexOverleafSkillInstalled({ skillId: 'annotated-rewrite', content, env });
    const skillPath = path.join(overleafSkillsRoot, 'annotated-rewrite', 'SKILL.md');
    assert.equal(fs.readFileSync(skillPath, 'utf8'), content);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('ensureCodexOverleafSkillInstalled does not overwrite an existing skill file', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-ensure-skill-'));
  const overleafSkillsRoot = path.join(home, '.codex-overleaf', 'skills');
  const env = { HOME: home, CODEX_OVERLEAF_SKILLS_ROOT: overleafSkillsRoot };
  const original = '# Original\n\nOriginal content.';
  const updated = '# Updated\n\nUpdated content.';
  try {
    ensureCodexOverleafSkillInstalled({ skillId: 'annotated-rewrite', content: original, env });
    ensureCodexOverleafSkillInstalled({ skillId: 'annotated-rewrite', content: updated, env });
    const skillPath = path.join(overleafSkillsRoot, 'annotated-rewrite', 'SKILL.md');
    assert.equal(fs.readFileSync(skillPath, 'utf8'), original);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('listCodexOverleafSkills includes official and removable flags', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-skills-list-'));
  const overleafSkillsRoot = path.join(home, '.codex-overleaf', 'skills');
  const env = { HOME: home, CODEX_OVERLEAF_SKILLS_ROOT: overleafSkillsRoot };
  try {
    installCodexOverleafSkill({
      skillId: 'annotated-rewrite',
      content: '# Annotated Rewrite\n\nContent.',
      env
    });
    installCodexOverleafSkill({
      skillId: 'custom-style',
      content: '# Custom Style\n\nContent.',
      env
    });
    const { skills } = listCodexOverleafSkills({ env });
    const official = skills.find(s => s.id === 'annotated-rewrite');
    const custom = skills.find(s => s.id === 'custom-style');
    assert.equal(official.official, true);
    assert.equal(official.removable, false);
    assert.equal(custom.official, false);
    assert.equal(custom.removable, true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
