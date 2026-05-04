'use strict';

const { spawn } = require('node:child_process');
const { collectMirrorChangesDetailed, getProjectMirror, syncOverleafToMirror } = require('./mirrorWorkspace');
const { computeLineDiff } = require('./diffEngine');
const { computeTextPatches } = require('./textPatch');
const { buildCodexHomeEnv } = require('./codexHome');
const { truncateText } = require('./debugLog');

async function runCodexSession({ params = {}, env = process.env, emit = () => {}, rootDir, executeCodex, signal } = {}) {
  throwIfAborted(signal);
  const projectId = params.projectId || params.project?.projectId || params.project?.id || params.project?.url || 'overleaf-project';

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

  const settings = buildCodexSettings(params);
  const runner = executeCodex || runCodexAppServerSession;
  const runnerResult = await runner({
    workspacePath: mirror.workspacePath,
    task: buildCodexTurnPrompt(params, mirror),
    userTask: String(params.task || ''),
    session: params.session || null,
    threadId: params.threadId || '',
    mode: params.mode || 'auto',
    model: params.model || '',
    reasoningEffort: params.reasoningEffort || '',
    sandboxMode: settings.sandboxMode,
    approvalPolicy: settings.approvalPolicy,
    env,
    emit,
    signal
  });
  throwIfAborted(signal);

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
  throwIfAborted(signal);

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

  emitCodexEvent(emit, 'overleaf.sync.changes', 'Local Codex changes collected for Overleaf sync', {
    changedCount: syncChanges.length,
    files: syncChanges.map(change => change.path),
    unsupportedCount: unsupportedChanges.length,
    unsupportedFiles: unsupportedChanges.map(change => change.path)
  }, 'completed');

  return {
    status: 'completed',
    projectId: mirror.projectKey,
    workspacePath: mirror.workspacePath,
    assistantMessage: cleanAssistantMessage(runnerResult?.assistantMessage),
    threadId: runnerResult?.threadId || '',
    syncChanges,
    unsupportedChanges
  };
}

function buildCodexTurnPrompt(params = {}, mirror = {}) {
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
    'Mode for this turn:',
    `- ${mode}`,
    '- ask: inspect and explain only; do not edit files.',
    '- confirm/auto: edit the local workspace directly when the request calls for changes. The browser bridge handles review, confirmation, deletion approval, and syncing back to Overleaf.',
    '',
    'Write expectation for this turn:',
    formatWriteExpectation({ mode, task: userTask }),
    '',
    'Current user request:',
    userTask || '(empty request)'
  ].join('\n');
}

function formatWriteExpectation({ mode = 'auto', task = '' } = {}) {
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
    const childEnv = buildCodexHomeEnv(input.env || process.env);
    const codexCommand = resolveCodexCommand(childEnv);
    if (!codexCommand) {
      reject(new Error('Codex CLI was not found. Install Codex or make sure the `codex` command is available in your login shell.'));
      return;
    }

    const child = spawn(codexCommand, ['app-server', '--listen', 'stdio://'], {
      env: childEnv,
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
      if (code !== 0) {
        fail(new Error(stderr || `codex app-server exited with code ${code}`));
      }
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
        response(message.id, { decision: input.mode === 'ask' ? 'decline' : 'accept' });
        return;
      }
      if (/commandExecution\/requestApproval/.test(message.method)) {
        response(message.id, decideCommandApproval({ mode: input.mode, params: message.params || {} }));
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

function decideCommandApproval({ mode = 'auto', params = {} } = {}) {
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

function isUnsupportedReasoningSummaryError(error) {
  const message = String(error?.message || error || '');
  return /unsupported_parameter/i.test(message) && /reasoning\.summary|summary/i.test(message);
}

function cleanAssistantMessage(value) {
  return String(value || '').trim();
}

module.exports = {
  buildCodexTurnPrompt,
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
