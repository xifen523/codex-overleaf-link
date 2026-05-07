'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { collectMirrorChangesDetailed, getProjectMirror, markMirrorDirty, syncOverleafToMirror } = require('./mirrorWorkspace');
const { computeLineDiff } = require('./diffEngine');
const { computeTextPatches } = require('./textPatch');
const { buildCodexHomeEnv } = require('./codexHome');
const { buildCodexSpeedArgs } = require('./codexArgs');
const { truncateText } = require('./debugLog');
const { enforceNativeOkResponseBudget } = require('./nativeResponseBudget');
const {
  getCodexOverleafSkillsRoot,
  loadSelectedCodexOverleafSkill,
  loadSelectedProjectSkills
} = require('./localSkills');

const PROJECT_CUSTOM_INSTRUCTIONS_MAX_CHARS = 12000;
const TURN_ATTACHMENTS_DIR = '.codex-overleaf-attachments';
const MAX_TURN_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const MAX_TURN_ATTACHMENTS = 8;
const MAX_TURN_ATTACHMENT_TOTAL_BYTES = MAX_TURN_ATTACHMENT_BYTES * MAX_TURN_ATTACHMENTS;

async function runCodexSession({ params = {}, env = process.env, emit = () => {}, rootDir, executeCodex, signal } = {}) {
  throwIfAborted(signal);
  const projectId = params.projectId || params.project?.projectId || params.project?.id || params.project?.url || 'overleaf-project';
  const skillInvocation = normalizeSkillInvocation(params.skillInvocation);
  const skillInstallTurn = isSkillInstallerInvocation(skillInvocation);
  if (skillInstallTurn && Array.isArray(params.attachments) && params.attachments.length) {
    throw new Error('Skill installer turns do not accept attachments');
  }

  let mirror;
  if (params.skipMirrorSync) {
    mirror = getProjectMirror(projectId, { rootDir });
    mirror.fileCount = 0;
  } else {
    emitCodexEvent(emit, 'overleaf.sync.started', 'Syncing Overleaf project to local workspace', {
      projectId,
      fileCount: Array.isArray(params.project?.files) ? params.project.files.length : 0
    });

    mirror = await syncOverleafToMirror({
      projectId,
      project: params.project || { files: [] },
      rootDir
    });
    throwIfAborted(signal);

    emitCodexEvent(emit, 'overleaf.sync.completed', 'Overleaf project synced to local workspace', {
      projectId: mirror.projectKey,
      workspacePath: mirror.workspacePath,
      fileCount: mirror.fileCount
    }, 'completed');
  }

  const projectLocalSkills = loadProjectLocalSkillsContext(params, mirror);
  if (projectLocalSkills.missing.length) {
    emitCodexEvent(emit, 'codex.local_skills.missing', 'Selected project-local skills were missing', {
      missingSkillIds: projectLocalSkills.missing
    }, 'failed');
  }
  const turnAttachments = materializeTurnAttachments(params.attachments, mirror.workspacePath);
  const settings = buildCodexSettings(params);
  const skillLoading = normalizeSkillLoadingSettings(params);
  const codexSkillInvocationContext = loadCodexSkillInvocationContext({
    skillInvocation,
    loadCodexOverleafSkills: skillLoading.loadCodexOverleafSkills,
    env,
    emit
  });
  const effectiveSkillInvocation = getEffectiveSkillInvocation(codexSkillInvocationContext);
  const runnerWorkspacePath = skillInstallTurn
    ? getCodexOverleafSkillsRoot({ env })
    : mirror.workspacePath;
  if (skillInstallTurn) {
    fs.mkdirSync(runnerWorkspacePath, { recursive: true });
  }
  const runner = executeCodex || runCodexAppServerSession;
  const runnerResult = await runner({
    workspacePath: runnerWorkspacePath,
    task: buildCodexTurnPrompt(params, mirror, projectLocalSkills, turnAttachments, codexSkillInvocationContext),
    userTask: String(params.task || ''),
    session: params.session || null,
    threadId: params.threadId || '',
    mode: params.mode || 'auto',
    model: params.model || '',
    reasoningEffort: params.reasoningEffort || '',
    speedTier: normalizeSpeedTier(params.speedTier),
    loadCodexLocalSkills: skillLoading.loadCodexLocalSkills,
    loadCodexOverleafSkills: skillLoading.loadCodexOverleafSkills,
    skillInvocation: effectiveSkillInvocation,
    installCodexOverleafSkillsTarget: skillInstallTurn,
    projectLocalSkills: null,
    sandboxMode: settings.sandboxMode,
    approvalPolicy: settings.approvalPolicy,
    env,
    emit,
    signal
  });
  throwIfAborted(signal);

  if (skillInstallTurn) {
    return enforceNativeOkResponseBudget({
      status: 'completed',
      projectId: mirror.projectKey,
      workspacePath: mirror.workspacePath,
      assistantMessage: cleanAssistantMessage(runnerResult?.assistantMessage),
      threadId: runnerResult?.threadId || '',
      syncChanges: [],
      unsupportedChanges: []
    });
  }

  const collected = await collectMirrorChangesDetailed({
    projectId,
    rootDir
  });
  const filteredChanges = filterSyncChangesForFocus({
    changes: collected.changes || [],
    focusFiles: params.focusFiles || params.session?.focusFiles,
    restrictToFocusFiles: params.restrictToFocusFiles
  });
  const rawSyncChanges = filteredChanges.changes;
  const unsupportedChanges = [
    ...(collected.unsupportedChanges || []),
    ...filteredChanges.unsupportedChanges
  ];
  if (rawSyncChanges.length || unsupportedChanges.length) {
    markMirrorDirty({
      projectId,
      rootDir,
      reason: params.mode === 'ask' ? 'ask_mode_local_changes' : 'codex_run_local_changes'
    });
  }
  throwIfAborted(signal);

  if (params.mode === 'ask') {
    emitCodexEvent(emit, 'overleaf.sync.changes', 'Ask mode finished without Overleaf writeback', {
      changedCount: 0,
      files: [],
      unsupportedCount: 0,
      unsupportedFiles: [],
      ignoredChangedCount: rawSyncChanges.length,
      ignoredUnsupportedCount: unsupportedChanges.length
    }, rawSyncChanges.length || unsupportedChanges.length ? 'warning' : 'completed');
    return enforceNativeOkResponseBudget({
      status: 'completed',
      projectId: mirror.projectKey,
      workspacePath: mirror.workspacePath,
      assistantMessage: cleanAssistantMessage(runnerResult?.assistantMessage),
      threadId: runnerResult?.threadId || '',
      syncChanges: [],
      unsupportedChanges: []
    });
  }

  const syncChanges = rawSyncChanges.map(change => {
    if (change.type === 'write' && typeof change.previousContent === 'string') {
      return {
        ...change,
        diff: computeLineDiff(change.previousContent, change.content),
        patches: computeTextPatches(change.previousContent, change.content)
      };
    }
    return change;
  });
  const response = enforceNativeOkResponseBudget({
    status: 'completed',
    projectId: mirror.projectKey,
    workspacePath: mirror.workspacePath,
    assistantMessage: cleanAssistantMessage(runnerResult?.assistantMessage),
    threadId: runnerResult?.threadId || '',
    syncChanges,
    unsupportedChanges
  });

  emitCodexEvent(emit, 'overleaf.sync.changes', 'Local Codex changes collected for Overleaf sync', {
    changedCount: response.syncChanges.length,
    files: response.syncChanges.map(change => change.path),
    unsupportedCount: response.unsupportedChanges.length,
    unsupportedFiles: response.unsupportedChanges.map(change => change.path)
  }, 'completed');

  return response;
}

function buildCodexTurnPrompt(params = {}, mirror = {}, projectLocalSkills, turnAttachments = [], codexSkillInvocationContext = null) {
  const userTask = String(params.task || '').trim();
  const mode = params.mode || 'auto';
  const session = params.session || {};
  const focusFiles = normalizeFocusFiles(params.focusFiles || session.focusFiles);

  return [
    'Same Codex Overleaf session context:',
    `Session id: ${session.id || 'none'}`,
    '',
    'Recent turns in this UI session:',
    formatSessionHistory(session.history),
    '',
    'Current Overleaf workspace:',
    `- Project: ${mirror.projectKey || params.projectId || params.project?.id || 'unknown'}`,
    `- Local workspace: ${mirror.workspacePath || 'current cwd'}`,
    '- The local workspace was synced from Overleaf immediately before this turn.',
    '- If the recent session history conflicts with the files in the workspace, trust the files.',
    '',
    'Focus files:',
    formatFocusFiles(focusFiles),
    '',
    'Compilation context (@compile-log):',
    formatCompileLogContext(params),
    '',
    'Project custom instructions:',
    formatCustomInstructionsContext(params),
    '',
    'Project local skills:',
    formatProjectLocalSkillsContext(params, mirror, projectLocalSkills),
    '',
    'Codex skill loading:',
    formatCodexSkillLoadingContext(params),
    '',
    'Selected Codex skill:',
    formatSkillInvocationContext(params, codexSkillInvocationContext),
    '',
    'Attachments for this turn:',
    formatTurnAttachmentsContext(turnAttachments),
    '',
    'Mode for this turn:',
    `- ${mode}`,
    '- ask: inspect and explain only; do not edit files.',
    '- confirm/auto: edit the local workspace directly when the request calls for changes. The browser bridge handles review, confirmation, deletion approval, and syncing back to Overleaf.',
    '',
    'Write expectation for this turn:',
    formatWriteExpectation({ mode, task: userTask, skillInvocation: params.skillInvocation }),
    '',
    'Current user request:',
    userTask || '(empty request)'
  ].join('\n');
}

function materializeTurnAttachments(attachments = [], workspacePath = '') {
  if (!workspacePath) {
    return [];
  }
  const attachmentDir = path.join(workspacePath, TURN_ATTACHMENTS_DIR);
  fs.rmSync(attachmentDir, { recursive: true, force: true });

  const normalized = normalizeTurnAttachments(attachments);
  if (!normalized.length) {
    return [];
  }

  fs.mkdirSync(attachmentDir, { recursive: true });
  const usedNames = new Set();
  return normalized.map(attachment => {
    const fileName = dedupeAttachmentFileName(attachment.name, usedNames);
    const target = path.join(attachmentDir, fileName);
    const resolvedTarget = path.resolve(target);
    const resolvedDir = path.resolve(attachmentDir);
    if (!resolvedTarget.startsWith(resolvedDir + path.sep)) {
      throw new Error('Unsafe attachment path');
    }
    fs.writeFileSync(target, attachment.bytes);
    return {
      name: fileName,
      path: `${TURN_ATTACHMENTS_DIR}/${fileName}`,
      mimeType: attachment.mimeType,
      size: attachment.bytes.length
    };
  });
}

function normalizeTurnAttachments(value) {
  const input = Array.isArray(value) ? value : [];
  if (input.length > MAX_TURN_ATTACHMENTS) {
    throw new Error(`Too many attachments (${input.length}/${MAX_TURN_ATTACHMENTS})`);
  }
  const result = [];
  let totalBytes = 0;
  for (const item of input) {
    const name = sanitizeAttachmentFileName(item?.name);
    const contentBase64 = String(item?.contentBase64 || '').replace(/\s+/g, '');
    if (!name || !contentBase64) {
      continue;
    }
    const declared = Number(item?.size);
    const estimatedBytes = Math.max(
      Number.isFinite(declared) && declared > 0 ? declared : 0,
      estimateBase64DecodedBytes(contentBase64)
    );
    if (estimatedBytes > MAX_TURN_ATTACHMENT_BYTES) {
      throw new Error(`Attachment is too large: ${name}`);
    }
    const bytes = Buffer.from(contentBase64, 'base64');
    if (!bytes.length) {
      continue;
    }
    if (bytes.length > MAX_TURN_ATTACHMENT_BYTES) {
      throw new Error(`Attachment is too large: ${name}`);
    }
    totalBytes += Math.max(estimatedBytes, bytes.length);
    if (totalBytes > MAX_TURN_ATTACHMENT_TOTAL_BYTES) {
      throw new Error(`Attachments are too large (${totalBytes}/${MAX_TURN_ATTACHMENT_TOTAL_BYTES} bytes)`);
    }
    result.push({
      name,
      mimeType: String(item?.mimeType || '').trim().slice(0, 120),
      bytes
    });
  }
  return result;
}

function estimateBase64DecodedBytes(value) {
  const clean = String(value || '').replace(/\s+/g, '');
  if (!clean) {
    return 0;
  }
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(clean.length * 3 / 4) - padding);
}

function sanitizeAttachmentFileName(value) {
  const basename = String(value || '')
    .replace(/\0/g, '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop()
    ?.trim()
    .slice(0, 180) || '';
  return basename.replace(/[/:]/g, '-');
}

function dedupeAttachmentFileName(name, usedNames) {
  let candidate = name || 'attachment';
  if (!usedNames.has(candidate)) {
    usedNames.add(candidate);
    return candidate;
  }
  const parsed = path.parse(candidate);
  let index = 2;
  do {
    candidate = `${parsed.name}-${index}${parsed.ext}`;
    index += 1;
  } while (usedNames.has(candidate));
  usedNames.add(candidate);
  return candidate;
}

function formatTurnAttachmentsContext(attachments = []) {
  if (!attachments.length) {
    return '- none provided.';
  }
  return [
    '- These files are user-provided context for this turn only.',
    '- Read them if relevant. Do not edit them, do not include them in writeback, and do not write them to Overleaf.',
    ...attachments.map(attachment => {
      const details = [
        attachment.mimeType || 'application/octet-stream',
        `${attachment.size} bytes`
      ].join(', ');
      return `- ${attachment.path} (${details})`;
    })
  ].join('\n');
}

function formatWriteExpectation({ mode = 'auto', task = '', skillInvocation = null } = {}) {
  if (isSkillInstallerInvocation(skillInvocation)) {
    return [
      '- This is a skill-install turn.',
      '- You may use network and local commands needed to install or list Codex skills.',
      '- Only install into $CODEX_HOME/skills, which is mapped to Codex Overleaf plugin skills for this turn.',
      '- Do not edit Overleaf project files.'
    ].join('\n');
  }
  if (mode === 'ask') {
    return '- This is read-only. Inspect and explain; do not edit files.';
  }
  if (requestImpliesFileChanges(task)) {
    return [
      '- The request asks for file changes. You must edit the local workspace when you find concrete fixes.',
      '- Do not stop at a suggestion list or say you will not modify files unless no safe concrete edit exists.',
      '- If you intentionally leave files unchanged, explain the specific blocker in the final answer.'
    ].join('\n');
  }
  return [
    '- This mode can write. If the request asks for corrections, revisions, fixes, polishing, updates, or implementation, edit the local workspace directly.',
    '- If the request is purely an inspection question, report findings without inventing unnecessary edits.'
  ].join('\n');
}

function requestImpliesFileChanges(task = '') {
  return /修正|修复|修改|改[一-龥]*|完善|补全|补充|润色|重写|改写|整理|调整|应用|写入|fix|correct|repair|revise|edit|update|rewrite|polish|improve|apply/i.test(String(task || ''));
}

function normalizeFocusFiles(value) {
  const seen = new Set();
  const files = [];
  for (const item of Array.isArray(value) ? value : []) {
    const filePath = normalizeProjectPath(item);
    if (!filePath || seen.has(filePath)) {
      continue;
    }
    seen.add(filePath);
    files.push(filePath);
    if (files.length >= 8) {
      break;
    }
  }
  return files;
}

function filterSyncChangesForFocus({ changes = [], focusFiles = [], restrictToFocusFiles = false } = {}) {
  if (!restrictToFocusFiles) {
    return { changes, unsupportedChanges: [] };
  }
  const focusSet = new Set(normalizeFocusFiles(focusFiles));
  if (!focusSet.size) {
    return { changes, unsupportedChanges: [] };
  }

  const accepted = [];
  const rejected = [];
  for (const change of changes || []) {
    if (focusSet.has(normalizeProjectPath(change?.path))) {
      accepted.push(change);
    } else if (change?.path) {
      rejected.push({
        type: 'ignored-local-change',
        path: change.path,
        reason: 'out_of_focus_partial_snapshot'
      });
    }
  }
  return {
    changes: accepted,
    unsupportedChanges: rejected
  };
}

function normalizeProjectPath(value) {
  return String(value || '')
    .replace(/^@file:/i, '')
    .replace(/\\/g, '/')
    .trim()
    .replace(/^\/+/, '');
}

function formatFocusFiles(files) {
  if (!files.length) {
    return '- none; use the whole project when needed.';
  }
  return files.map(filePath => `- ${filePath}`).join('\n');
}

function formatCompileLogContext(params = {}) {
  const log = String(params.compileLog || '').trim();
  if (!log) {
    return '- none provided.';
  }

  const errors = normalizeCompileMessages(params.compileErrors);
  const warnings = normalizeCompileMessages(params.compileWarnings);
  const fresh = params.compileLogFresh === false
    ? 'possibly stale'
    : 'fresh';
  const compiledAt = params.compileLogCompiledAt
    ? new Date(params.compileLogCompiledAt).toISOString()
    : 'unknown';

  return [
    `- status: ${fresh}`,
    `- compiledAt: ${compiledAt}`,
    `- errors: ${errors.length}`,
    `- warnings: ${warnings.length}`,
    errors.length ? `- error summary:\n${errors.slice(0, 8).map(message => `  - ${message}`).join('\n')}` : '',
    warnings.length ? `- warning summary:\n${warnings.slice(0, 8).map(message => `  - ${message}`).join('\n')}` : '',
    '- log:',
    fencedBlock(log)
  ].filter(Boolean).join('\n');
}

function formatCustomInstructionsContext(params = {}) {
  const instructions = truncateText(
    String(params.customInstructions || '').trim(),
    PROJECT_CUSTOM_INSTRUCTIONS_MAX_CHARS
  );
  if (!instructions) {
    return '- none provided.';
  }
  return fencedBlock(instructions);
}

function loadProjectLocalSkillsContext(params = {}, mirror = {}) {
  const selectedSkillIds = Array.isArray(params.selectedSkillIds) ? params.selectedSkillIds : [];
  if (!selectedSkillIds.length) {
    return { skills: [], missing: [], selected: [] };
  }
  const projectId = mirror.projectKey || params.projectId || params.project?.id || params.project?.projectId;
  return loadSelectedProjectSkills({
    projectId,
    selectedSkillIds,
    rootDir: params.rootDir,
    projectRoot: mirror.projectRoot
  });
}

function formatProjectLocalSkillsContext(params = {}, mirror = {}, projectLocalSkills) {
  const selectedSkillIds = Array.isArray(params.selectedSkillIds) ? params.selectedSkillIds : [];
  if (!selectedSkillIds.length) {
    return '- none selected.';
  }
  const loaded = projectLocalSkills || loadProjectLocalSkillsContext(params, mirror);
  const sections = [];
  for (const skill of loaded.skills) {
    sections.push([
      `## ${skill.id}: ${skill.title || skill.id}`,
      fencedBlock(skill.content)
    ].join('\n'));
  }
  if (loaded.missing.length) {
    sections.push([
      'Missing selected local skills:',
      loaded.missing.map(id => `- ${id}`).join('\n')
    ].join('\n'));
  }
  return sections.length ? sections.join('\n\n') : '- none loaded.';
}

function normalizeSkillLoadingSettings(params = {}) {
  return {
    loadCodexLocalSkills: params.loadCodexLocalSkills !== false,
    loadCodexOverleafSkills: params.loadCodexOverleafSkills !== false
  };
}

function formatCodexSkillLoadingContext(params = {}) {
  const settings = normalizeSkillLoadingSettings(params);
  return [
    `- Codex local skills: ${settings.loadCodexLocalSkills ? 'enabled' : 'disabled'}`,
    `- Codex Overleaf skills: ${settings.loadCodexOverleafSkills ? 'enabled' : 'disabled'}`
  ].join('\n');
}

function loadCodexSkillInvocationContext({
  skillInvocation,
  loadCodexOverleafSkills = true,
  env = process.env,
  emit = () => {}
} = {}) {
  const invocation = normalizeSkillInvocation(skillInvocation);
  if (!invocation) {
    return { invocation: null, skill: null, missing: [], ignored: [] };
  }
  if (isSkillInstallerInvocation(invocation)) {
    return { invocation, skill: null, missing: [], ignored: [] };
  }

  const result = loadSelectedCodexOverleafSkill({
    skillId: invocation.id,
    loadCodexOverleafSkills,
    env
  });
  if (result.missing.length) {
    emitCodexEvent(emit, 'codex.overleaf_skills.missing', 'Selected Codex Overleaf skill was missing', {
      missingSkillIds: result.missing
    }, 'failed');
  }
  if (result.ignored.length) {
    emitCodexEvent(emit, 'codex.overleaf_skill_invocation.ignored', 'Selected Codex Overleaf skill was ignored', {
      ignoredSkillIds: result.ignored.map(item => item.id),
      reason: result.ignored[0]?.reason || 'ignored'
    }, 'warning');
  }

  return {
    invocation,
    skill: result.skill,
    missing: result.missing,
    ignored: result.ignored
  };
}

function getEffectiveSkillInvocation(context = {}) {
  const invocation = normalizeSkillInvocation(context.invocation);
  if (!invocation) {
    return null;
  }
  if (isSkillInstallerInvocation(invocation)) {
    return invocation;
  }
  return context.skill ? invocation : null;
}

function normalizeSkillInvocation(value) {
  const id = String(value?.id || '').trim();
  if (!isSafeSkillId(id)) {
    return null;
  }
  const title = String(value?.title || 'Skill Installer').trim().slice(0, 80) || 'Skill Installer';
  if (id === 'skill-installer') {
    return { id, title };
  }
  if (value?.scope !== 'codex-overleaf') {
    return null;
  }
  return { id, title, scope: 'codex-overleaf' };
}

function isSkillInstallerInvocation(value) {
  return normalizeSkillInvocation(value)?.id === 'skill-installer';
}

function isSafeSkillId(id) {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(String(id || ''))
    && !String(id || '').includes('..');
}

function formatSkillInvocationContext(params = {}, codexSkillInvocationContext = null) {
  const invocation = normalizeSkillInvocation(params.skillInvocation);
  const contextInvocation = normalizeSkillInvocation(codexSkillInvocationContext?.invocation);
  const effectiveInvocation = contextInvocation || invocation;
  if (Array.isArray(codexSkillInvocationContext?.ignored) && codexSkillInvocationContext.ignored.length) {
    return [
      'Ignored selected Codex Overleaf skill:',
      ...codexSkillInvocationContext.ignored.map(item => `- ${item.id}`),
      '- Reason: Codex Overleaf skills are disabled for this turn.',
      '- The stale slash selection was ignored; no selected skill instructions were forced into this prompt.'
    ].join('\n');
  }
  if (Array.isArray(codexSkillInvocationContext?.missing) && codexSkillInvocationContext.missing.length) {
    return [
      'Missing selected Codex Overleaf skill:',
      ...codexSkillInvocationContext.missing.map(id => `- ${id}`),
      '- The stale slash selection was ignored; no selected skill instructions were forced into this prompt.'
    ].join('\n');
  }
  if (!effectiveInvocation) {
    return '- none.';
  }
  if (isSkillInstallerInvocation(effectiveInvocation)) {
    return [
      `- ${effectiveInvocation.id} (${effectiveInvocation.title})`,
      '- Use the Codex skill-installer behavior for this turn.',
      '- Install skills into the Codex Overleaf plugin skill home; this bridge maps $CODEX_HOME/skills to that persistent plugin skills directory.',
      '- Accept natural-language requests, curated skill names, GitHub repo paths, or GitHub URLs.',
      '- If the request does not name a skill or location, list installable curated skills and ask which one to install.',
      '- Do not edit the Overleaf project workspace or write installed skill files into the project mirror.'
    ].join('\n');
  }
  const loadedSkill = codexSkillInvocationContext?.skill;
  if (loadedSkill) {
    return [
      `- ${effectiveInvocation.id} (${effectiveInvocation.title})`,
      '- REQUIRED for this turn: read and use this selected Codex Overleaf skill before answering.',
      '- Follow the embedded SKILL.md instructions when they apply to the current user request.',
      '',
      'Selected Codex Overleaf SKILL.md:',
      `## ${loadedSkill.id}: ${loadedSkill.title || effectiveInvocation.title || loadedSkill.id}`,
      fencedBlock(loadedSkill.content)
    ].join('\n');
  }
  return [
    `- ${effectiveInvocation.id} (${effectiveInvocation.title})`,
    '- Use this selected Codex Overleaf skill for the current turn.',
    '- Follow the skill instructions and workflow when they apply to the user request.'
  ].join('\n');
}

function normalizeCompileMessages(value) {
  const messages = Array.isArray(value) ? value : [];
  return messages
    .map(message => String(message || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function fencedBlock(value) {
  return [
    '```text',
    String(value || '').replace(/```/g, '` ` `'),
    '```'
  ].join('\n');
}

function formatSessionHistory(history) {
  const turns = Array.isArray(history) ? history.slice(-8) : [];
  if (!turns.length) {
    return '- none';
  }
  return turns.map((turn, index) => {
    const task = truncateText(String(turn?.task || 'untitled task'), 600);
    const result = truncateText(String(turn?.result || turn?.status || 'no result recorded'), 1200);
    return `${index + 1}. User asked: ${task}\n   Previous outcome: ${result}`;
  }).join('\n');
}

function buildCodexSettings(params = {}) {
  if (isSkillInstallerInvocation(params.skillInvocation)) {
    return {
      sandboxMode: 'workspace-write',
      approvalPolicy: 'never'
    };
  }
  if (params.mode === 'ask') {
    return {
      sandboxMode: 'read-only',
      approvalPolicy: 'never'
    };
  }
  return {
    sandboxMode: 'workspace-write',
    approvalPolicy: 'never'
  };
}

function buildThreadStartParams(input = {}) {
  return {
    cwd: input.workspacePath,
    model: input.model || null,
    approvalPolicy: input.approvalPolicy,
    sandbox: input.sandboxMode,
    experimentalRawEvents: false
  };
}

function buildThreadResumeParams(input = {}) {
  return {
    threadId: input.threadId,
    cwd: input.workspacePath,
    model: input.model || null,
    approvalPolicy: input.approvalPolicy,
    sandbox: input.sandboxMode
  };
}

function buildCodexAppServerArgs(input = {}) {
  const args = [
    ...buildCodexSpeedArgs(normalizeSpeedTier(input.speedTier))
  ];
  if (input.loadCodexLocalSkills === false) {
    args.push('--disable', 'plugins');
  }
  args.push(
    'app-server',
    '--listen',
    'stdio://'
  );
  return [
    ...args
  ];
}

async function applyCodexSkillIsolation({ input = {}, childEnv = process.env, request, emit = () => {} } = {}) {
  if (input.loadCodexLocalSkills !== false) {
    return { disabled: [] };
  }
  if (typeof request !== 'function') {
    throw new Error('Codex skill isolation requires an app-server request function');
  }

  const listResult = await request('skills/list', {
    cwd: input.workspacePath,
    includeDisabled: true
  });
  const skills = flattenCodexSkillsList(listResult);
  const disabled = [];
  for (const skill of skills) {
    if (skill?.enabled === false || !shouldDisableCodexSkillForIsolation(skill, input, childEnv)) {
      continue;
    }
    const params = buildSkillDisableParams(skill);
    if (!params) {
      continue;
    }
    await request('skills/config/write', params);
    disabled.push(String(skill.name || skill.path || '').trim());
  }
  if (disabled.length) {
    emitCodexEvent(emit, 'codex.skill_isolation.applied', 'Disabled non-Overleaf Codex skills for this turn', {
      disabledSkillNames: disabled.filter(Boolean)
    }, 'completed');
  }
  return { disabled };
}

function flattenCodexSkillsList(listResult = {}) {
  const data = Array.isArray(listResult?.data) ? listResult.data : [];
  return data.flatMap(entry => Array.isArray(entry?.skills) ? entry.skills : []);
}

function shouldDisableCodexSkillForIsolation(skill = {}, input = {}, childEnv = process.env) {
  if (isCodexSystemSkill(skill)) {
    return !isAllowedSystemSkillForIsolation(skill, input);
  }
  return !isAllowedCodexOverleafSkillPath(skill.path, input, childEnv);
}

function isCodexSystemSkill(skill = {}) {
  return String(skill.scope || '') === 'system' || isSystemSkillPath(skill.path);
}

function isAllowedSystemSkillForIsolation(skill = {}, input = {}) {
  return input.installCodexOverleafSkillsTarget === true && String(skill.name || '') === 'skill-installer';
}

function isAllowedCodexOverleafSkillPath(skillPath, input = {}, childEnv = process.env) {
  if (input.loadCodexOverleafSkills === false && input.installCodexOverleafSkillsTarget !== true) {
    return false;
  }
  const pathText = String(skillPath || '');
  if (!pathText || !path.isAbsolute(pathText) || isSystemSkillPath(pathText)) {
    return false;
  }
  const roots = [
    path.join(String(childEnv.CODEX_HOME || ''), 'skills'),
    getCodexOverleafSkillsRoot({ env: childEnv })
  ].filter(Boolean);
  return roots.some(root => isInsideOrSamePath(pathText, root));
}

function isSystemSkillPath(skillPath) {
  return String(skillPath || '').split(path.sep).includes('.system');
}

function buildSkillDisableParams(skill = {}) {
  const name = String(skill.name || '').trim();
  if (isCodexSystemSkill(skill) && name) {
    return { name, enabled: false };
  }
  const skillPath = String(skill.path || '').trim();
  if (path.isAbsolute(skillPath)) {
    return { path: skillPath, enabled: false };
  }
  if (name) {
    return { name, enabled: false };
  }
  return null;
}

function isInsideOrSamePath(target, root) {
  const targetPaths = comparablePaths(target);
  const rootPaths = comparablePaths(root);
  return targetPaths.some(targetPath => rootPaths.some(rootPath => (
    targetPath === rootPath || targetPath.startsWith(rootPath + path.sep)
  )));
}

function comparablePaths(value) {
  const resolved = path.resolve(String(value || ''));
  const candidates = [resolved];
  try {
    candidates.push(fs.realpathSync.native(resolved));
  } catch (_) {
    // Fall back to the lexical path when the file is not present yet.
  }
  return Array.from(new Set(candidates));
}

function buildTurnStartParams(input = {}, threadId = input.threadId || '') {
  const params = {
    threadId,
    input: [
      {
        type: 'text',
        text: input.task,
        text_elements: []
      }
    ],
    cwd: input.workspacePath,
    model: input.model || null,
    effort: normalizeReasoningEffort(input.reasoningEffort)
  };
  if (supportsReasoningSummary(input.model)) {
    params.summary = 'detailed';
  }
  return params;
}

function supportsReasoningSummary(model) {
  return String(model || '').toLowerCase() !== 'gpt-5.3-codex-spark';
}

function runCodexAppServerSession(input) {
  return new Promise((resolve, reject) => {
    if (input.signal?.aborted) {
      reject(getAbortReason(input.signal));
      return;
    }
    const childEnv = buildCodexHomeEnv(input.env || process.env, {
      loadCodexLocalSkills: input.loadCodexLocalSkills !== false,
      loadCodexOverleafSkills: input.loadCodexOverleafSkills !== false,
      installCodexOverleafSkillsTarget: input.installCodexOverleafSkillsTarget === true,
      projectLocalSkills: input.projectLocalSkills || null
    });
    const codexCommand = resolveCodexCommand(childEnv);
    if (!codexCommand) {
      reject(new Error('Codex CLI was not found. Install Codex or make sure the `codex` command is available in your login shell.'));
      return;
    }

    const child = spawn(codexCommand, buildCodexAppServerArgs(input), {
      env: childEnv,
      shell: shouldUseShellForCommand(codexCommand, childEnv),
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const pending = new Map();
    let nextId = 1;
    let stdoutBuffer = '';
    let stderr = '';
    let activeThreadId = '';
    let activeTurnId = '';
    const assistantMessages = new Map();
    const assistantMessageOrder = [];
    let settled = false;
    const timeout = createOptionalTimeout(childEnv.CODEX_OVERLEAF_CODEX_TIMEOUT_MS, timeoutMs => {
      fail(new Error(`Codex app-server did not complete within configured timeout (${timeoutMs}ms)`));
    });
    const onAbort = () => {
      fail(getAbortReason(input.signal));
    };
    input.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) {
          handleMessage(line);
        }
      }
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.on('error', fail);
    child.on('close', code => {
      if (settled) {
        return;
      }
      fail(new Error(stderr || `codex app-server exited before turn completed with code ${code}`));
    });

    start().catch(fail);

    async function start() {
      await request('initialize', {
        clientInfo: {
          name: 'codex-overleaf-link',
          version: '0.1.0'
        },
        capabilities: null
      });
      notify('initialized');
      await applyCodexSkillIsolation({
        input,
        childEnv,
        request,
        emit: input.emit
      });

      if (input.threadId) {
        try {
          const resumeResponse = await request('thread/resume', buildThreadResumeParams(input));
          activeThreadId = resumeResponse?.thread?.id || resumeResponse?.threadId || input.threadId;
        } catch (resumeError) {
          const error = new Error(resumeError.message || 'thread/resume failed');
          error.code = 'thread_resume_failed';
          throw error;
        }
      } else {
        const threadResponse = await request('thread/start', buildThreadStartParams(input));
        activeThreadId = threadResponse?.thread?.id || threadResponse?.threadId || '';
        if (!activeThreadId) {
          throw new Error('Codex app-server did not return a thread id');
        }
      }

      const turnResponse = await startTurnWithSummaryFallback(activeThreadId);
      activeTurnId = turnResponse?.turn?.id || '';
    }

    async function startTurnWithSummaryFallback(threadId) {
      const params = buildTurnStartParams(input, threadId);
      try {
        return await request('turn/start', params);
      } catch (error) {
        if (!params.summary || !isUnsupportedReasoningSummaryError(error)) {
          throw error;
        }
        emitCodexEvent(input.emit, 'codex.session.event', 'reasoning summary unsupported; retrying without it', {
          method: 'turn/start',
          params: {
            model: input.model || '',
            retriedWithoutSummary: true
          }
        }, 'completed');
        const retryParams = { ...params };
        delete retryParams.summary;
        return request('turn/start', retryParams);
      }
    }

    function request(method, params) {
      const id = nextId++;
      const message = { id, method, params };
      child.stdin.write(`${JSON.stringify(message)}\n`);
      return new Promise((resolveRequest, rejectRequest) => {
        pending.set(id, {
          resolve: resolveRequest,
          reject: rejectRequest
        });
      });
    }

    function notify(method, params) {
      child.stdin.write(`${JSON.stringify({ method, params })}\n`);
    }

    function response(id, result) {
      child.stdin.write(`${JSON.stringify({ id, result })}\n`);
    }

    function handleMessage(line) {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        emitCodexEvent(input.emit, 'codex.session.raw', 'Codex app-server emitted non-JSON output', {
          text: truncateText(line, 1000)
        });
        return;
      }

      if (Object.prototype.hasOwnProperty.call(message, 'id') && (message.result || message.error)) {
        const pendingRequest = pending.get(message.id);
        if (!pendingRequest) {
          return;
        }
        pending.delete(message.id);
        if (message.error) {
          pendingRequest.reject(new Error(message.error.message || JSON.stringify(message.error)));
        } else {
          pendingRequest.resolve(message.result);
        }
        return;
      }

      if (Object.prototype.hasOwnProperty.call(message, 'id') && message.method) {
        handleServerRequest(message);
        return;
      }

      if (message.method) {
        recordAssistantMessage(message);
        emitCodexEvent(input.emit, 'codex.session.event', message.method, {
          method: message.method,
          params: message.params || {}
        }, inferNotificationStatus(message));
        if (message.method === 'turn/completed' && (!activeTurnId || message.params?.turn?.id === activeTurnId || message.params?.turnId === activeTurnId)) {
          succeed();
        }
        if (message.method === 'error') {
          fail(new Error(message.params?.error?.message || 'Codex turn failed'));
        }
      }
    }

    function handleServerRequest(message) {
      emitCodexEvent(input.emit, 'codex.session.request', message.method, {
        method: message.method,
        params: message.params || {}
      }, 'running');

      if (/fileChange\/requestApproval/.test(message.method)) {
        if (isSkillInstallerInvocation(input.skillInvocation)) {
          response(message.id, { decision: 'decline', reason: 'Skill installation must not edit Overleaf workspace files.' });
          return;
        }
        response(message.id, { decision: input.mode === 'ask' ? 'decline' : 'accept' });
        return;
      }
      if (/commandExecution\/requestApproval/.test(message.method)) {
        response(message.id, decideCommandApproval({
          mode: input.mode,
          skillInvocation: input.skillInvocation,
          env: childEnv,
          workspacePath: input.workspacePath,
          params: message.params || {}
        }));
        return;
      }
      response(message.id, { decision: 'decline' });
    }

    function recordAssistantMessage(message) {
      const method = String(message.method || '');
      const params = message.params || {};
      const item = params.item || {};
      if (method === 'item/agentMessage/delta') {
        const itemId = String(params.itemId || item.id || 'current');
        const next = `${assistantMessages.get(itemId) || ''}${String(params.delta || '')}`;
        setAssistantMessage(itemId, next);
        return;
      }
      if (item.type === 'agentMessage' && typeof item.text === 'string' && item.text.trim()) {
        const itemId = String(item.id || params.itemId || 'current');
        setAssistantMessage(itemId, item.text);
      }
    }

    function setAssistantMessage(itemId, text) {
      if (!assistantMessages.has(itemId)) {
        assistantMessageOrder.push(itemId);
      }
      assistantMessages.set(itemId, text);
    }

    function succeed() {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      child.kill('SIGTERM');
      resolve({
        assistantMessage: buildFinalAssistantMessage(assistantMessages, assistantMessageOrder),
        threadId: activeThreadId
      });
    }

    function fail(error) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      for (const pendingRequest of pending.values()) {
        pendingRequest.reject(error);
      }
      pending.clear();
      if (child.exitCode === null && !child.killed) {
        child.kill('SIGTERM');
      }
      reject(error);
    }

    function cleanup() {
      timeout.cancel();
      input.signal?.removeEventListener('abort', onAbort);
    }
  });
}

function decideCommandApproval({ mode = 'auto', params = {}, skillInvocation = null, env = process.env, workspacePath = '' } = {}) {
  if (isSkillInstallerInvocation(skillInvocation)) {
    return decideSkillInstallerCommandApproval({ params, env, workspacePath });
  }
  if (mode === 'ask') {
    return { decision: 'decline' };
  }
  return isAllowedLocalCommand(params)
    ? { decision: 'accept' }
    : {
      decision: 'decline',
      reason: 'Command is outside the Codex Overleaf local inspection/LaTeX allowlist.'
    };
}

function decideSkillInstallerCommandApproval({ params = {}, env = process.env, workspacePath = '' } = {}) {
  if (isAllowedInstallerInspectionCommand(params, env, workspacePath)) {
    return { decision: 'accept' };
  }

  const command = extractCommandValue(params);
  if (typeof command === 'string' && hasUnsupportedShellSyntax(command)) {
    return declineSkillInstallerCommand();
  }
  const tokens = Array.isArray(command) ? command.map(String) : tokenizeShellCommand(String(command || ''));
  if (!tokens.length || tokens.some(isUnsafeShellToken)) {
    return declineSkillInstallerCommand();
  }

  const executable = pathBasename(tokens[0]);
  if (['bash', 'sh', 'zsh'].includes(executable)) {
    const inline = extractShellInlineCommand(tokens);
    return inline
      ? decideSkillInstallerCommandApproval({ params: { command: inline }, env, workspacePath })
      : declineSkillInstallerCommand();
  }

  if (!isAllowedSkillInstallerCommand(executable, tokens, env, workspacePath)) {
    return declineSkillInstallerCommand();
  }
  return { decision: 'accept' };
}

function isAllowedInstallerInspectionCommand(params = {}, env = process.env, workspacePath = '') {
  const command = extractCommandValue(params);
  if (typeof command === 'string' && hasUnsupportedShellSyntax(command)) {
    return false;
  }
  const tokens = Array.isArray(command) ? command.map(String) : tokenizeShellCommand(String(command || ''));
  if (!tokens.length || tokens.some(isUnsafeShellToken)) {
    return false;
  }

  const executable = pathBasename(tokens[0]);
  if (['bash', 'sh', 'zsh'].includes(executable)) {
    const inline = extractShellInlineCommand(tokens);
    return inline ? isAllowedInstallerInspectionCommand({ command: inline }, env, workspacePath) : false;
  }

  const allowed = new Set([
    'rg', 'grep', 'cat', 'head', 'tail', 'nl', 'ls',
    'wc', 'diff', 'sort', 'tr', 'cut', 'uniq',
    'stat', 'file', 'basename', 'dirname', 'realpath',
    'shasum', 'md5', 'md5sum'
  ]);
  return allowed.has(executable)
    && !hasDisallowedInstallerInspectionArguments(executable, tokens.slice(1))
    && areInstallerInspectionReadPathsContained(executable, tokens.slice(1), env, workspacePath);
}

function hasDisallowedInstallerInspectionArguments(executable, args = []) {
  if (hasDisallowedCommandArguments(executable, args)) {
    return true;
  }
  const flags = args.map(String);
  if (executable === 'sort') {
    return flags.some((flag, index) => flag === '-o'
      || flag.startsWith('-o')
      || flags[index - 1] === '-o'
      || flag === '--output'
      || flag.startsWith('--output=')
      || flags[index - 1] === '--output');
  }
  if (executable === 'rg') {
    return flags.some(flag => flag === '--pre' || flag.startsWith('--pre='));
  }
  return false;
}

function areInstallerInspectionReadPathsContained(executable, args = [], env = process.env, workspacePath = '') {
  const parsed = parseInstallerInspectionReadPaths(executable, args);
  return parsed.valid
    && parsed.paths.every(target => isInstallerReadPathInsideAllowedRoot(target, env, workspacePath));
}

function parseInstallerInspectionReadPaths(executable, args = []) {
  if (executable === 'tr') {
    return { valid: true, paths: [] };
  }
  if (executable === 'rg' || executable === 'grep') {
    return parseSearchInspectionReadPaths(executable, args);
  }
  const parsed = collectInstallerInspectionArguments(executable, args);
  return parsed.valid
    ? { valid: true, paths: parsed.optionPathValues.concat(parsed.positionals) }
    : { valid: false, paths: [] };
}

function parseSearchInspectionReadPaths(executable, args = []) {
  const parsed = collectInstallerInspectionArguments(executable, args);
  if (!parsed.valid) {
    return { valid: false, paths: [] };
  }

  const paths = [...parsed.optionPathValues];
  if (parsed.noPatternMode || parsed.usesPatternOption) {
    paths.push(...parsed.positionals);
  } else if (parsed.positionals.length > 1) {
    paths.push(...parsed.positionals.slice(1));
  }

  return { valid: true, paths };
}

function collectInstallerInspectionArguments(executable, args = []) {
  const spec = getInstallerInspectionOptionSpec(executable);
  const result = {
    valid: true,
    positionals: [],
    optionPathValues: [],
    usesPatternOption: false,
    noPatternMode: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const token = String(args[index] || '');
    if (!token) {
      return { ...result, valid: false };
    }

    if (token === '--') {
      result.positionals.push(...args.slice(index + 1).map(String));
      break;
    }

    if (token !== '-' && token.startsWith('--')) {
      const handled = collectLongInstallerInspectionOption(token, args, index, spec, result);
      if (!handled.valid) {
        return { ...result, valid: false };
      }
      if (handled.consumed) {
        index += handled.consumed;
      }
      continue;
    }

    if (token !== '-' && token.startsWith('-')) {
      const handled = collectShortInstallerInspectionOption(token, args, index, spec, result);
      if (!handled.valid) {
        return { ...result, valid: false };
      }
      if (handled.consumed) {
        index += handled.consumed;
      }
      continue;
    }

    result.positionals.push(token);
  }

  return result;
}

function collectLongInstallerInspectionOption(token, args, index, spec, result) {
  const equalsIndex = token.indexOf('=');
  const name = equalsIndex >= 0 ? token.slice(0, equalsIndex) : token;
  const inlineValue = equalsIndex >= 0 ? token.slice(equalsIndex + 1) : null;
  if (spec.noPatternModeOptions.has(name)) {
    result.noPatternMode = true;
  }

  if (inlineValue !== null) {
    collectInstallerInspectionOptionValue(name, inlineValue, spec, result);
    return { valid: true, consumed: 0 };
  }

  if (optionRequiresValue(name, spec)) {
    if (index + 1 >= args.length) {
      return { valid: false, consumed: 0 };
    }
    collectInstallerInspectionOptionValue(name, String(args[index + 1] || ''), spec, result);
    return { valid: true, consumed: 1 };
  }

  return { valid: true, consumed: 0 };
}

function collectShortInstallerInspectionOption(token, args, index, spec, result) {
  const attached = findAttachedShortInstallerInspectionOption(token, spec);
  if (attached) {
    collectInstallerInspectionOptionValue(attached.name, attached.value, spec, result);
    return { valid: true, consumed: 0 };
  }

  if (spec.noPatternModeOptions.has(token)) {
    result.noPatternMode = true;
  }
  if (optionRequiresValue(token, spec)) {
    if (index + 1 >= args.length) {
      return { valid: false, consumed: 0 };
    }
    collectInstallerInspectionOptionValue(token, String(args[index + 1] || ''), spec, result);
    return { valid: true, consumed: 1 };
  }

  return { valid: true, consumed: 0 };
}

function findAttachedShortInstallerInspectionOption(token, spec) {
  const options = [
    ...spec.pathValueOptions,
    ...spec.patternValueOptions,
    ...spec.valueOptions
  ].filter(option => /^-[A-Za-z]$/.test(option));
  const option = options.find(candidate => token.startsWith(candidate) && token.length > candidate.length);
  return option ? { name: option, value: token.slice(option.length) } : null;
}

function collectInstallerInspectionOptionValue(name, value, spec, result) {
  if (spec.pathValueOptions.has(name)) {
    result.optionPathValues.push(value);
  }
  if (spec.patternValueOptions.has(name) || spec.patternPathValueOptions.has(name)) {
    result.usesPatternOption = true;
  }
}

function optionRequiresValue(name, spec) {
  return spec.pathValueOptions.has(name)
    || spec.patternValueOptions.has(name)
    || spec.valueOptions.has(name);
}

function getInstallerInspectionOptionSpec(executable) {
  if (executable === 'rg') {
    return buildInstallerInspectionOptionSpec({
      pathValueOptions: ['-f', '--file', '--ignore-file'],
      patternPathValueOptions: ['-f', '--file'],
      patternValueOptions: ['-e', '--regexp'],
      valueOptions: [
        '-A', '--after-context', '-B', '--before-context', '-C', '--context',
        '-g', '--glob', '--iglob', '-j', '--threads', '-m', '--max-count',
        '-r', '--replace', '-t', '--type', '-T', '--type-not',
        '--color', '--colors', '--context-separator', '--encoding', '--engine',
        '--field-context-separator', '--field-match-separator', '--filter',
        '--max-depth', '--max-filesize', '--path-separator', '--pre-glob',
        '--sort', '--sortr'
      ],
      noPatternModeOptions: ['--files']
    });
  }
  if (executable === 'grep') {
    return buildInstallerInspectionOptionSpec({
      pathValueOptions: ['-f', '--file', '--exclude-from'],
      patternPathValueOptions: ['-f', '--file'],
      patternValueOptions: ['-e', '--regexp'],
      valueOptions: [
        '-A', '--after-context', '-B', '--before-context', '-C', '--context',
        '-D', '--devices', '-d', '--directories', '-m', '--max-count',
        '--binary-files', '--exclude', '--group-separator', '--include', '--label'
      ]
    });
  }
  if (executable === 'head' || executable === 'tail') {
    return buildInstallerInspectionOptionSpec({
      valueOptions: ['-c', '--bytes', '-n', '--lines']
    });
  }
  if (executable === 'cut') {
    return buildInstallerInspectionOptionSpec({
      valueOptions: [
        '-b', '--bytes', '-c', '--characters', '-d', '--delimiter',
        '-f', '--fields', '--output-delimiter'
      ]
    });
  }
  if (executable === 'sort') {
    return buildInstallerInspectionOptionSpec({
      pathValueOptions: ['-T', '--temporary-directory'],
      valueOptions: ['-k', '--key', '-S', '--buffer-size', '-t', '--field-separator']
    });
  }
  if (executable === 'shasum') {
    return buildInstallerInspectionOptionSpec({
      valueOptions: ['-a', '--algorithm']
    });
  }
  return buildInstallerInspectionOptionSpec();
}

function buildInstallerInspectionOptionSpec(input = {}) {
  return {
    pathValueOptions: new Set(input.pathValueOptions || []),
    patternPathValueOptions: new Set(input.patternPathValueOptions || []),
    patternValueOptions: new Set(input.patternValueOptions || []),
    valueOptions: new Set(input.valueOptions || []),
    noPatternModeOptions: new Set(input.noPatternModeOptions || [])
  };
}

function declineSkillInstallerCommand() {
  return {
    decision: 'decline',
    reason: 'Skill installation commands must be recognized and write only under Codex Overleaf skill roots.'
  };
}

function isAllowedSkillInstallerCommand(executable, tokens, env, workspacePath) {
  if (['python', 'python3', 'node'].includes(executable)) {
    return false;
  }
  if (executable === 'git') {
    return isAllowedGitInstallerCommand(tokens, env, workspacePath);
  }
  return false;
}

function isAllowedGitInstallerCommand(tokens = [], env = process.env, workspacePath = '') {
  const parsed = parseGitCloneInstallerCommand(tokens, workspacePath);
  if (!parsed) {
    return false;
  }
  return isAllowedGitCloneUrl(parsed.url)
    && parsed.writeTargets.length > 0
    && parsed.writeTargets.every(target => isInstallerPathInsideAllowedSkillRoot(target, env, workspacePath));
}

function parseGitCloneInstallerCommand(tokens = [], workspacePath = '') {
  if (tokens[1] !== 'clone') {
    return null;
  }
  const writeTargets = [];
  const positionals = [];
  for (let index = 2; index < tokens.length; index += 1) {
    const token = String(tokens[index] || '');
    if (!token) {
      return null;
    }

    if (token === '--') {
      for (let positionalIndex = index + 1; positionalIndex < tokens.length; positionalIndex += 1) {
        positionals.push(String(tokens[positionalIndex] || ''));
      }
      break;
    }

    if (isDisallowedGitCloneOption(token)) {
      return null;
    }

    const separateGitDir = token.match(/^--separate-git-dir=(.+)$/);
    if (separateGitDir) {
      writeTargets.push(separateGitDir[1]);
      continue;
    }
    if (token === '--separate-git-dir') {
      if (index + 1 >= tokens.length) {
        return null;
      }
      writeTargets.push(tokens[index + 1]);
      index += 1;
      continue;
    }
    if (isAllowedGitCloneBooleanOption(token)) {
      continue;
    }
    const inlineOption = parseAllowedGitCloneInlineOption(token);
    if (inlineOption) {
      if (!isAllowedGitCloneOptionValue(inlineOption.name, inlineOption.value)) {
        return null;
      }
      continue;
    }
    if (isAllowedGitCloneValueOption(token)) {
      if (index + 1 >= tokens.length || !isAllowedGitCloneOptionValue(token, tokens[index + 1])) {
        return null;
      }
      index += 1;
      continue;
    }
    if (token.startsWith('-')) {
      return null;
    }
    positionals.push(token);
  }

  if (positionals.length < 1 || positionals.length > 2 || !positionals.every(Boolean)) {
    return null;
  }

  if (positionals.length === 2) {
    writeTargets.push(positionals[1]);
  } else {
    writeTargets.push(workspacePath || '.');
  }
  return {
    url: positionals[0],
    writeTargets
  };
}

function isDisallowedGitCloneOption(token) {
  return token === '-c'
    || token.startsWith('-c')
    || token === '--config'
    || token.startsWith('--config=')
    || token === '--upload-pack'
    || token.startsWith('--upload-pack=')
    || token === '-u'
    || token.startsWith('-u');
}

function isAllowedGitCloneBooleanOption(token) {
  return new Set([
    '--quiet',
    '-q',
    '--verbose',
    '-v',
    '--progress',
    '--no-checkout',
    '-n',
    '--bare',
    '--mirror',
    '--single-branch',
    '--no-single-branch',
    '--no-tags'
  ]).has(token);
}

function parseAllowedGitCloneInlineOption(token) {
  const match = String(token || '').match(/^(--depth|--branch|--filter|--origin)=(.+)$/);
  return match ? { name: match[1], value: match[2] } : null;
}

function isAllowedGitCloneValueOption(token) {
  return new Set(['--depth', '--branch', '-b', '--filter', '--origin', '-o']).has(token);
}

function isAllowedGitCloneOptionValue(option, value) {
  const text = String(value || '');
  if (!text || text.startsWith('-') || /[\0\r\n]/.test(text)) {
    return false;
  }
  if (option === '--depth') {
    return /^[1-9][0-9]{0,5}$/.test(text);
  }
  if (option === '--branch' || option === '-b') {
    return isSafeGitRefName(text);
  }
  if (option === '--filter') {
    return /^(blob:none|tree:[0-9]+)$/.test(text);
  }
  if (option === '--origin' || option === '-o') {
    return /^[A-Za-z0-9._-]{1,64}$/.test(text) && !text.includes('..');
  }
  return false;
}

function isSafeGitRefName(value) {
  const text = String(value || '');
  return text.length <= 200
    && !text.includes('..')
    && !text.includes('//')
    && !text.includes('@{')
    && !text.endsWith('.')
    && !/[\\\s~^:?*[\]\0\r\n]/.test(text);
}

function isAllowedGitCloneUrl(value) {
  const text = String(value || '').trim();
  if (!text || /^ext::/i.test(text)) {
    return false;
  }
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function isInstallerReadPathInsideAllowedRoot(value, env = process.env, workspacePath = '') {
  if (!isReadablePathArgument(value)) {
    return true;
  }
  const expanded = expandInstallerPath(value, env, workspacePath);
  return Boolean(expanded) && isInsideAllowedInstallerReadRoot(expanded, env, workspacePath);
}

function isReadablePathArgument(value) {
  const text = String(value || '').trim();
  return Boolean(text) && text !== '-';
}

function isInstallerPathInsideAllowedSkillRoot(value, env = process.env, workspacePath = '') {
  const expanded = expandInstallerPath(value, env, workspacePath);
  return Boolean(expanded) && isInsideAllowedSkillWriteRoot(expanded, env);
}

function expandInstallerPath(value, env = process.env, workspacePath = '') {
  const text = String(value || '').trim();
  if (!text || isUrlLike(text)) {
    return '';
  }
  let expanded = text;
  if (expanded === '~' || expanded.startsWith('~/')) {
    const home = String(env.HOME || '');
    if (!home || !path.isAbsolute(home)) {
      return '';
    }
    expanded = expanded === '~' ? home : path.join(home, expanded.slice(2));
  } else if (expanded.startsWith('~')) {
    return '';
  }
  expanded = expandInstallerEnvironmentVariables(expanded, env);
  if (expanded.includes('$')) {
    return '';
  }
  return path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(workspacePath || process.cwd(), expanded);
}

function expandInstallerEnvironmentVariables(value, env = process.env) {
  return String(value || '').replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (_, bracedName, bareName) => String(env[bracedName || bareName] || '')
  );
}

function isInsideAllowedInstallerReadRoot(target, env = process.env, workspacePath = '') {
  try {
    const approvedRootSymlinkTargets = getApprovedSkillRootSymlinkTargets(env);
    const roots = getAllowedInstallerReadRoots(env, workspacePath);
    return roots.some(root => isSafeContainedReadTarget(target, root, { approvedRootSymlinkTargets }));
  } catch {
    return false;
  }
}

function getAllowedInstallerReadRoots(env = process.env, workspacePath = '') {
  const roots = [
    workspacePath,
    path.join(String(env.CODEX_HOME || ''), 'skills'),
    getCodexOverleafSkillsRoot({ env })
  ];
  return Array.from(new Set(
    roots
      .filter(root => root && path.isAbsolute(root))
      .map(root => path.resolve(root))
  ));
}

function isInsideAllowedSkillRoot(target, env = process.env) {
  try {
    const roots = [
      path.join(String(env.CODEX_HOME || ''), 'skills'),
      getCodexOverleafSkillsRoot({ env })
    ].filter(root => root && path.isAbsolute(root));
    return roots.some(root => isInsideOrSamePath(target, root));
  } catch {
    return false;
  }
}

function isInsideAllowedSkillWriteRoot(target, env = process.env) {
  try {
    const approvedRootSymlinkTargets = getApprovedSkillRootSymlinkTargets(env);
    const roots = [
      path.join(String(env.CODEX_HOME || ''), 'skills'),
      getCodexOverleafSkillsRoot({ env })
    ].filter(root => root && path.isAbsolute(root));
    return roots.some(root => isSafeContainedWriteTarget(target, root, { approvedRootSymlinkTargets }));
  } catch {
    return false;
  }
}

function getApprovedSkillRootSymlinkTargets(env = process.env) {
  const targets = new Set();
  const overleafSkillsRoot = getCodexOverleafSkillsRoot({ env });
  const realRoot = safeRealpathNonSymlinkDirectory(overleafSkillsRoot);
  if (realRoot) {
    targets.add(realRoot);
  }
  return targets;
}

function isSafeContainedReadTarget(target, root, options = {}) {
  const resolvedTarget = path.resolve(String(target || ''));
  const resolvedRoot = path.resolve(String(root || ''));
  if (!isLexicallyInsideOrSame(resolvedTarget, resolvedRoot)) {
    return false;
  }

  const rootExists = fs.existsSync(resolvedRoot);
  const rootReal = safeRealpathDirectory(resolvedRoot, options.approvedRootSymlinkTargets);
  if (rootExists && !rootReal) {
    return false;
  }
  const relativeParts = path.relative(resolvedRoot, resolvedTarget).split(path.sep).filter(Boolean);
  let current = resolvedRoot;
  if (!rootExists) {
    return true;
  }

  for (let index = 0; index < relativeParts.length; index += 1) {
    current = path.join(current, relativeParts[index]);
    if (!fs.existsSync(current)) {
      return true;
    }
    const isFinalPart = index === relativeParts.length - 1;
    const safe = isFinalPart
      ? isSafeExistingReadPath(current, rootReal)
      : isSafeExistingDirectory(current, rootReal);
    if (!safe) {
      return false;
    }
  }
  return true;
}

function safeRealpathNonSymlinkDirectory(target) {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      return '';
    }
    return fs.realpathSync.native(target);
  } catch {
    return '';
  }
}

function isSafeContainedWriteTarget(target, root, options = {}) {
  const resolvedTarget = path.resolve(String(target || ''));
  const resolvedRoot = path.resolve(String(root || ''));
  if (!isLexicallyInsideOrSame(resolvedTarget, resolvedRoot)) {
    return false;
  }

  const rootReal = safeRealpathDirectory(resolvedRoot, options.approvedRootSymlinkTargets);
  const relativeParts = path.relative(resolvedRoot, resolvedTarget).split(path.sep).filter(Boolean);
  let current = resolvedRoot;
  if (!isSafeExistingDirectory(current, rootReal)) {
    return !fs.existsSync(current);
  }

  for (const part of relativeParts) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) {
      return true;
    }
    if (!isSafeExistingDirectory(current, rootReal)) {
      return false;
    }
  }
  return true;
}

function isSafeExistingReadPath(target, rootReal) {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) {
      if (!rootReal) {
        return false;
      }
      const realTarget = fs.realpathSync.native(target);
      return isLexicallyInsideOrSame(realTarget, rootReal);
    }
    if (!rootReal) {
      return true;
    }
    const realTarget = fs.realpathSync.native(target);
    return isLexicallyInsideOrSame(realTarget, rootReal);
  } catch (error) {
    return error.code === 'ENOENT';
  }
}

function safeRealpathDirectory(target, approvedRootSymlinkTargets = new Set()) {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) {
      const realTarget = fs.realpathSync.native(target);
      return fs.statSync(realTarget).isDirectory() && approvedRootSymlinkTargets.has(realTarget)
        ? realTarget
        : '';
    }
    if (!stat.isDirectory()) {
      return '';
    }
    return fs.realpathSync.native(target);
  } catch {
    return '';
  }
}

function isSafeExistingDirectory(target, rootReal) {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) {
      if (!rootReal) {
        return false;
      }
      const realTarget = fs.realpathSync.native(target);
      return isLexicallyInsideOrSame(realTarget, rootReal);
    }
    if (!stat.isDirectory()) {
      return false;
    }
    if (!rootReal) {
      return true;
    }
    const realTarget = fs.realpathSync.native(target);
    return isLexicallyInsideOrSame(realTarget, rootReal);
  } catch (error) {
    return error.code === 'ENOENT';
  }
}

function isLexicallyInsideOrSame(target, root) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function isUrlLike(value) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(String(value || ''));
}

function isAllowedLocalCommand(params = {}) {
  const command = extractCommandValue(params);
  if (typeof command === 'string' && hasUnsupportedShellSyntax(command)) {
    return false;
  }
  const tokens = Array.isArray(command) ? command.map(String) : tokenizeShellCommand(String(command || ''));
  if (!tokens.length) {
    return false;
  }

  const executable = pathBasename(tokens[0]);
  if (['bash', 'sh', 'zsh'].includes(executable)) {
    const inline = extractShellInlineCommand(tokens);
    return inline ? isAllowedLocalCommand({ command: inline }) : false;
  }

  const allowed = new Set([
    'rg', 'grep', 'cat', 'sed', 'head', 'tail', 'nl', 'find', 'ls',
    'wc', 'diff', 'sort', 'tr', 'awk', 'printf', 'cut', 'uniq',
    'stat', 'file', 'basename', 'dirname', 'realpath',
    'shasum', 'md5', 'md5sum',
    'latexmk', 'pdflatex', 'xelatex', 'lualatex', 'bibtex', 'biber',
    'kpsewhich', 'chktex', 'lacheck'
  ]);
  if (!allowed.has(executable)) {
    return false;
  }

  return !tokens.some(isUnsafeShellToken)
    && !hasDisallowedCommandArguments(executable, tokens.slice(1));
}

function extractCommandValue(params = {}) {
  if (Array.isArray(params.command) || typeof params.command === 'string') {
    return params.command;
  }
  if (Array.isArray(params.cmd) || typeof params.cmd === 'string') {
    return params.cmd;
  }
  if (Array.isArray(params.argv)) {
    return params.argv;
  }
  if (typeof params.shellCommand === 'string') {
    return params.shellCommand;
  }
  return '';
}

function extractShellInlineCommand(tokens = []) {
  const index = tokens.findIndex(token => token === '-c' || token === '-lc' || token === '-ilc');
  if (index < 0 || index + 1 >= tokens.length || tokens.length !== index + 2) {
    return '';
  }
  return tokens[index + 1];
}

function hasUnsupportedShellSyntax(command) {
  return hasAmbiguousShellEscape(command) || hasUnbalancedShellQuote(command);
}

function hasAmbiguousShellEscape(command) {
  return /\\["';&|<>`$(){}\n\r]/.test(command);
}

function hasUnbalancedShellQuote(command) {
  let quote = '';
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (char === '\\' && quote !== "'") {
      index += 1;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = '';
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
    }
  }
  return Boolean(quote);
}

function isUnsafeShellToken(token) {
  return ['&&', '||', ';', '|', '>', '>>', '<', '<<', '`'].includes(token)
    || /\$\(/.test(token);
}

function hasDisallowedCommandArguments(executable, args = []) {
  const flags = args.map(String);
  if (executable === 'find') {
    return flags.some(flag => ['-exec', '-execdir', '-delete', '-ok', '-okdir'].includes(flag));
  }
  if (executable === 'sed') {
    return flags.some(flag => flag === '-i' || /^-i[^a-zA-Z0-9]?/.test(flag));
  }
  if (executable === 'awk') {
    return flags.some((flag, index) => flag === '-i' && flags[index + 1] === 'inplace');
  }
  if (executable === 'shasum' || executable === 'md5sum') {
    return flags.some(flag => flag === '-c' || flag === '--check');
  }
  return false;
}

function pathBasename(value) {
  return String(value || '').split(/[\\/]/).pop();
}

function tokenizeShellCommand(command) {
  const tokens = [];
  let current = '';
  let quote = '';
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === quote) {
        quote = '';
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    if (char === '&' && command[index + 1] === '&') {
      if (current) tokens.push(current);
      tokens.push('&&');
      current = '';
      index += 1;
      continue;
    }
    if (char === '|' && command[index + 1] === '|') {
      if (current) tokens.push(current);
      tokens.push('||');
      current = '';
      index += 1;
      continue;
    }
    if (';|<>`'.includes(char)) {
      if (current) tokens.push(current);
      tokens.push(char);
      current = '';
      continue;
    }
    current += char;
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function createOptionalTimeout(value, onTimeout) {
  const timeoutMs = parseOptionalPositiveInteger(value);
  if (!timeoutMs) {
    return {
      cancel() {}
    };
  }
  const timer = setTimeout(() => onTimeout(timeoutMs), timeoutMs);
  return {
    cancel() {
      clearTimeout(timer);
    }
  };
}

function parseOptionalPositiveInteger(value) {
  if (value === undefined || value === null || value === '') {
    return 0;
  }
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) {
    return;
  }
  throw getAbortReason(signal);
}

function getAbortReason(signal) {
  if (signal?.reason instanceof Error) {
    return signal.reason;
  }
  const error = new Error('Codex run was cancelled by the user');
  error.code = 'codex_cancelled';
  return error;
}

function resolveCodexCommand(env = process.env) {
  if (
    env.CODEX_OVERLEAF_ENV_READY === '1' ||
    Object.prototype.hasOwnProperty.call(env, 'CODEX_OVERLEAF_CODEX_PATH')
  ) {
    return env.CODEX_OVERLEAF_CODEX_PATH || '';
  }
  return 'codex';
}

function shouldUseShellForCommand(command, env = process.env) {
  const platform = env.CODEX_OVERLEAF_PLATFORM || process.platform;
  if (platform !== 'win32') {
    return false;
  }
  const text = String(command || '');
  return text === 'codex' || /\.(?:cmd|bat)$/i.test(text);
}

function buildFinalAssistantMessage(messages = new Map(), order = []) {
  const values = [];
  const seenIds = new Set();
  const ids = order.length ? order : Array.from(messages.keys());

  for (const id of ids) {
    seenIds.add(id);
    addAssistantMessage(values, messages.get(id));
  }
  for (const [id, value] of messages) {
    if (!seenIds.has(id)) {
      addAssistantMessage(values, value);
    }
  }

  return values.join('\n\n');
}

function addAssistantMessage(values, value) {
  const clean = cleanAssistantMessage(value);
  if (clean && !values.includes(clean)) {
    values.push(clean);
  }
}

function emitCodexEvent(emit, type, title, detail = {}, status = 'running') {
  emit({
    type,
    title,
    status,
    detail,
    timestamp: new Date().toISOString()
  });
}

function inferNotificationStatus(message) {
  if (/completed|updated|delta|started/.test(message.method || '')) {
    return /completed/.test(message.method || '') ? 'completed' : 'running';
  }
  return 'running';
}

function normalizeReasoningEffort(value) {
  return ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(value) ? value : null;
}

function normalizeSpeedTier(value) {
  return value === 'fast' ? 'fast' : 'standard';
}

function isUnsupportedReasoningSummaryError(error) {
  const message = String(error?.message || error || '');
  return /unsupported_parameter/i.test(message) && /reasoning\.summary|summary/i.test(message);
}

function cleanAssistantMessage(value) {
  return String(value || '').trim();
}

module.exports = {
  applyCodexSkillIsolation,
  buildCodexTurnPrompt,
  buildCodexAppServerArgs,
  buildFinalAssistantMessage,
  buildCodexSettings,
  buildThreadStartParams,
  buildThreadResumeParams,
  buildTurnStartParams,
  createOptionalTimeout,
  decideCommandApproval,
  runCodexAppServerSession,
  runCodexSession
};
