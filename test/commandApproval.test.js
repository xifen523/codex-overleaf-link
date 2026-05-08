const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  evaluateSkillCommand,
  validateGitCloneUrl
} = require('../native-host/src/commandApproval');

test('evaluateSkillCommand approves contained read-only inspection', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-skills-'));
  try {
    const skillFile = path.join(root, 'style', 'SKILL.md');
    fs.mkdirSync(path.dirname(skillFile), { recursive: true });
    fs.writeFileSync(skillFile, 'style skill', 'utf8');

    const result = evaluateSkillCommand({
      executable: 'cat',
      args: [skillFile],
      cwd: root
    }, {
      skillsRoot: root
    });

    assert.equal(result.approved, true);
    assert.equal(result.category, 'read-only');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('evaluateSkillCommand approves HTTPS git clone into the skill root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-skills-'));
  try {
    const result = evaluateSkillCommand({
      executable: 'git',
      args: ['clone', '--depth', '1', 'https://github.com/example/skill.git', 'skill'],
      cwd: root
    }, {
      skillsRoot: root
    });

    assert.equal(result.approved, true);
    assert.equal(result.category, 'contained-write');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('evaluateSkillCommand blocks non-HTTPS or escaping git clone targets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-skills-'));
  try {
    const ssh = evaluateSkillCommand({
      executable: 'git',
      args: ['clone', 'git@github.com:example/skill.git', 'skill'],
      cwd: root
    }, {
      skillsRoot: root
    });
    const outside = evaluateSkillCommand({
      executable: 'git',
      args: ['clone', 'https://github.com/example/skill.git', '../outside'],
      cwd: root
    }, {
      skillsRoot: root
    });

    assert.equal(ssh.approved, false);
    assert.equal(ssh.category, 'blocked');
    assert.equal(outside.approved, false);
    assert.equal(outside.category, 'blocked');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('validateGitCloneUrl allows only absolute HTTPS URLs', () => {
  assert.deepEqual(validateGitCloneUrl('https://github.com/example/skill.git'), {
    safe: true,
    reason: 'Git clone URL uses HTTPS.'
  });
  assert.equal(validateGitCloneUrl('http://github.com/example/skill.git').safe, false);
  assert.equal(validateGitCloneUrl('ext::sh -c evil').safe, false);
  assert.equal(validateGitCloneUrl('git@github.com:example/skill.git').safe, false);
});
