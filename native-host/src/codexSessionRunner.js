'use strict';

const { spawn } = require('node:child_process');
const { collectMirrorChanges, syncOverleafToMirror } = require('./mirrorWorkspace');
const { computeLineDiff } = require('./diffEngine');
const { truncateText } = require('./debugLog');

async function runCodexSession({ params = {}, env = process.env, emit = () => {}, rootDir, executeCodex } = {}) {
  const projectId = params.projectId || params.project?.projectId || params.project?.id || params.project?.url || 'overleaf-project';
  emitCodexEvent(emit, 'overleaf.sync.started', 'Syncing Overleaf project to local workspace', {
    projectId,
    fileCount: Array.isArray(params.project?.files) ? params.project.files.length : 0
  });

  const mirror = await syncOverleafToMirror({
    projectId,
    project: params.project || { files: [] },
    rootDir
  });

  emitCodexEvent(emit, 'overleaf.sync.completed', 'Overleaf project synced to local workspace', {
    projectId: mirror.projectKey,
    workspacePath: mirror.workspacePath,
    fileCount: mirror.fileCount
  }, 'completed');

  const settings = buildCodexSettings(params);
  const runner = executeCodex || runCodexAppServerSession;
  const runnerResult = await runner({
    workspacePath: mirror.workspacePath,
    task: String(params.task || ''),
    mode: params.mode || 'auto',
    model: params.model || '',
    reasoningEffort: params.reasoningEffort || '',
    sandboxMode: settings.sandboxMode,
    approvalPolicy: settings.approvalPolicy,
    env,
    emit
  });

  const rawSyncChanges = await collectMirrorChanges({
    projectId,
    rootDir
  });

  const syncChanges = rawSyncChanges.map(change => {
    if (change.type === 'write' && typeof change.previousContent === 'string') {
      return {
        ...change,
        diff: computeLineDiff(change.previousContent, change.content)
      };
    }
    return change;
  });

  emitCodexEvent(emit, 'overleaf.sync.changes', 'Local Codex changes collected for Overleaf sync', {
    changedCount: syncChanges.length,
    files: syncChanges.map(change => change.path)
  }, 'completed');

  return {
    status: 'completed',
    projectId: mirror.projectKey,
    workspacePath: mirror.workspacePath,
    assistantMessage: cleanAssistantMessage(runnerResult?.assistantMessage),
    syncChanges
  };
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

function runCodexAppServerSession(input) {
  return new Promise((resolve, reject) => {
    const codexCommand = resolveCodexCommand(input.env || process.env);
    if (!codexCommand) {
      reject(new Error('Codex CLI was not found. Install Codex or make sure the `codex` command is available in your login shell.'));
      return;
    }

    const child = spawn(codexCommand, ['app-server', '--listen', 'stdio://'], {
      env: input.env || process.env,
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
    const timeoutMs = 10 * 60 * 1000;
    const timeout = setTimeout(() => {
      fail(new Error(`Codex app-server timed out after ${timeoutMs}ms`));
    }, timeoutMs);

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
      const threadResponse = await request('thread/start', buildThreadStartParams(input));
      activeThreadId = threadResponse?.thread?.id || threadResponse?.threadId || '';
      if (!activeThreadId) {
        throw new Error('Codex app-server did not return a thread id');
      }
      const turnResponse = await request('turn/start', {
        threadId: activeThreadId,
        input: [
          {
            type: 'text',
            text: input.task,
            text_elements: []
          }
        ],
        cwd: input.workspacePath,
        model: input.model || null,
        effort: normalizeReasoningEffort(input.reasoningEffort),
        summary: 'detailed'
      });
      activeTurnId = turnResponse?.turn?.id || '';
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
        response(message.id, { decision: input.mode === 'ask' ? 'decline' : 'accept' });
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
      clearTimeout(timeout);
      child.kill('SIGTERM');
      resolve({
        assistantMessage: buildFinalAssistantMessage(assistantMessages, assistantMessageOrder)
      });
    }

    function fail(error) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      for (const pendingRequest of pending.values()) {
        pendingRequest.reject(error);
      }
      pending.clear();
      if (child.exitCode === null && !child.killed) {
        child.kill('SIGTERM');
      }
      reject(error);
    }
  });
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

function cleanAssistantMessage(value) {
  return String(value || '').trim();
}

module.exports = {
  buildFinalAssistantMessage,
  buildCodexSettings,
  buildThreadStartParams,
  runCodexAppServerSession,
  runCodexSession
};
