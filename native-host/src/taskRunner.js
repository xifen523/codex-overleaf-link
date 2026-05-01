'use strict';

const { spawn } = require('node:child_process');
const { buildOperationSummary, splitDeletePlan } = require('../../extension/src/shared/summary');
const { runCodexSession } = require('./codexSessionRunner');
const { logDebug, truncateText } = require('./debugLog');
const { HOST_NAME } = require('./manifest');

const pendingPlans = new Map();

async function handleRequest(request, env = process.env, emit = () => {}) {
  if (!request || typeof request !== 'object') {
    return errorResponse(undefined, 'invalid_request', 'Request must be an object');
  }

  if (request.method === 'bridge.ping') {
    return okResponse(request.id, {
      host: HOST_NAME,
      platform: 'darwin',
      protocolVersion: 1
    });
  }

  if (request.method === 'mirror.sync') {
    return handleMirrorSync(request, env);
  }

  if (request.method === 'codex.run') {
    return handleCodexRun(request, env, emit);
  }

  if (request.method === 'task.run') {
    return handleTaskRun(request, env, emit);
  }

  if (request.method === 'task.confirm') {
    return handleTaskConfirm(request);
  }

  return errorResponse(request.id, 'method_not_found', `Unknown method: ${request.method}`);
}

async function handleCodexRun(request, env, emit) {
  try {
    const result = await runCodexSession({
      params: request.params || {},
      env,
      emit,
      rootDir: env.CODEX_OVERLEAF_MIRROR_ROOT
    });
    const syncChanges = Array.isArray(result.syncChanges) ? result.syncChanges : [];
    return okResponse(request.id, {
      ...result,
      syncChanges
    });
  } catch (error) {
    logDebug('codex.run.failed', {
      message: error.message,
      stack: error.stack
    });
    return errorResponse(request.id, 'codex_run_failed', truncateText(error.message, 12000));
  }
}

async function handleMirrorSync(request, env) {
  const { syncOverleafToMirror } = require('./mirrorWorkspace');
  const params = request.params || {};
  const projectId = params.projectId || 'unknown';
  const rootDir = env.CODEX_OVERLEAF_MIRROR_ROOT;

  try {
    const result = await syncOverleafToMirror({
      projectId,
      project: params.project || { files: [] },
      rootDir
    });
    return okResponse(request.id, {
      fileCount: result.fileCount,
      writtenCount: result.writtenCount || 0,
      projectKey: result.projectKey
    });
  } catch (error) {
    return errorResponse(request.id, 'mirror_sync_failed', error.message);
  }
}

async function handleTaskRun(request, env, emit) {
  const params = request.params || {};
  const mode = params.mode;

  if (!['ask', 'confirm', 'auto'].includes(mode)) {
    return errorResponse(request.id, 'invalid_mode', 'Mode must be "ask", "confirm", or "auto"');
  }

  if (mode === 'auto' && !params.checkpoint?.ok && !isVerifiedReviewing(params.reviewing)) {
    return errorResponse(request.id, 'safety_required', 'Auto Mode requires an Overleaf checkpoint or verified Reviewing/Track Changes');
  }

  const fileCount = Array.isArray(params.project?.files) ? params.project.files.length : 0;
  const totalChars = Array.isArray(params.project?.files)
    ? params.project.files.reduce((sum, file) => sum + String(file?.content || '').length, 0)
    : 0;
  emitTaskEvent(emit, 'native.task.received', 'Native bridge received task', {
    mode,
    model: params.model,
    reasoningEffort: params.reasoningEffort,
    fileCount,
    totalChars
  });

  let agentSpec;
  try {
    agentSpec = resolveExternalAgent(env);
  } catch (error) {
    return errorResponse(request.id, 'invalid_agent_command', error.message);
  }

  if (agentSpec) {
    try {
      logDebug('agent.run.start', {
        command: agentSpec.label,
        mode,
        model: params.model,
        reasoningEffort: params.reasoningEffort,
        fileCount
      });
      emitTaskEvent(emit, 'agent.command.started', 'Codex agent command started', {
        mode,
        model: params.model,
        reasoningEffort: params.reasoningEffort,
        fileCount
      });
      const result = await runExternalAgent(agentSpec, params, emit, {
        timeoutMs: parsePositiveInteger(env.CODEX_OVERLEAF_AGENT_TIMEOUT_MS, 10 * 60 * 1000),
        outputMaxBytes: parsePositiveInteger(env.CODEX_OVERLEAF_AGENT_OUTPUT_MAX_BYTES, 1024 * 1024)
      });
      logDebug('agent.run.ok', {
        status: result?.status,
        operationCount: Array.isArray(result?.operations) ? result.operations.length : 0
      });
      emitTaskEvent(emit, 'agent.command.completed', 'Codex agent command completed', {
        status: result?.status || 'completed',
        operationCount: Array.isArray(result?.operations) ? result.operations.length : 0
      }, 'completed');
      return okResponse(request.id, prepareResultForResponse(mode, normalizeAgentResult(mode, result, params)));
    } catch (error) {
      logDebug('agent.run.failed', {
        message: error.message,
        stack: error.stack
      });
      emitTaskEvent(emit, 'agent.command.failed', 'Codex agent command failed', {
        message: error.message
      }, 'failed');
      return errorResponse(request.id, 'agent_failed', truncateText(error.message, 12000));
    }
  }

  const operations = params.proposedOperations || [];
  return okResponse(request.id, prepareResultForResponse(mode, buildDefaultTaskResult(mode, operations, params)));
}

function isVerifiedReviewing(reviewing) {
  return reviewing?.ok === true && reviewing.status !== 'manual-override';
}

async function handleTaskConfirm(request) {
  const planId = request.params?.planId;
  if (!planId || !pendingPlans.has(planId)) {
    return errorResponse(request.id, 'plan_not_found', 'No pending task plan matched the supplied planId');
  }

  const plan = pendingPlans.get(planId);
  pendingPlans.delete(planId);

  return okResponse(request.id, {
    status: 'confirmed',
    notes: plan.notes || '',
    userReport: plan.userReport,
    operations: plan.operations
  });
}

function buildDefaultTaskResult(mode, operations, params = {}) {
  if (mode === 'ask') {
    return {
      status: 'completed',
      summary: buildOperationSummary([]),
      notes: '',
      userReport: buildDefaultUserReport(mode, [], params),
      operations: []
    };
  }

  const summary = buildOperationSummary(operations);

  if (mode === 'confirm') {
    return {
      status: 'requires_task_confirmation',
      summary,
      notes: '',
      userReport: buildDefaultUserReport(mode, operations, params),
      operations
    };
  }

  const split = splitDeletePlan(operations);
  if (split.needsConfirmation.length > 0) {
    return {
      status: 'delete_plan_required',
      summary: buildOperationSummary(split.immediate),
      notes: '',
      userReport: buildDefaultUserReport(mode, operations, params),
      operations: split.immediate,
      deletePlan: buildOperationSummary(split.needsConfirmation).deletePlan,
      pendingOperations: split.needsConfirmation
    };
  }

  return {
    status: 'completed',
    summary,
    notes: '',
    userReport: buildDefaultUserReport(mode, operations, params),
    operations
  };
}

function normalizeAgentResult(mode, result, params = {}) {
  const operations = Array.isArray(result.operations) ? result.operations : [];
  if (mode === 'ask') {
    return {
      status: 'completed',
      summary: buildOperationSummary([]),
      notes: typeof result.notes === 'string' ? result.notes : '',
      userReport: normalizeUserReport(result.userReport, buildDefaultUserReport(mode, [], params)),
      operations: []
    };
  }

  const normalized = {
    ...result,
    summary: result.summary || buildOperationSummary(operations),
    notes: typeof result.notes === 'string' ? result.notes : '',
    userReport: normalizeUserReport(result.userReport, buildDefaultUserReport(mode, collectResultOperations(result), params)),
    operations
  };

  if (!normalized.status) {
    normalized.status = mode === 'confirm' ? 'requires_task_confirmation' : 'completed';
  }

  return normalized;
}

function prepareResultForResponse(mode, result) {
  if (mode === 'auto') {
    const operations = collectResultOperations(result);
    const split = splitDeletePlan(operations);
    if (split.needsConfirmation.length > 0) {
      return {
        ...result,
        status: 'delete_plan_required',
        summary: buildOperationSummary(split.immediate),
        operations: split.immediate,
        deletePlan: buildOperationSummary(split.needsConfirmation).deletePlan,
        pendingOperations: split.needsConfirmation
      };
    }
  }

  const confirmOperations = mode === 'confirm' ? collectResultOperations(result) : [];
  if (confirmOperations.length > 0) {
    result = {
      ...result,
      status: 'requires_task_confirmation',
      summary: buildOperationSummary(confirmOperations),
      operations: confirmOperations
    };
  }

  if (mode !== 'confirm' || result.status !== 'requires_task_confirmation') {
    return result;
  }

  const planId = `plan_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  pendingPlans.set(planId, {
    notes: result.notes || '',
    userReport: result.userReport,
    operations: Array.isArray(result.operations) ? result.operations : []
  });

  const {
    operations: _operations,
    pendingOperations: _pendingOperations,
    deletePlan: _deletePlan,
    ...redacted
  } = result;
  return {
    ...redacted,
    planId
  };
}

function buildDefaultUserReport(mode, operations = [], params = {}) {
  const checked = (params.project?.files || [])
    .map(file => file?.path)
    .filter(path => typeof path === 'string' && path.length > 0)
    .slice(0, 20);
  const hasOperations = operations.length > 0;

  return {
    conclusion: hasOperations
      ? 'Codex 已准备好建议修改，等待确认或写入。'
      : '这轮任务已完成，没有写入 Overleaf 文件。',
    checked,
    findings: [],
    plannedChanges: hasOperations ? operations.map(formatOperationForUserReport) : [],
    appliedChanges: [],
    unchangedReason: hasOperations ? '' : (mode === 'ask' ? '这轮是只问不改。' : ''),
    nextStep: hasOperations
      ? '请确认修改方案后写入 Overleaf。'
      : '可以继续追问，或加入更多 @context 后再检查。'
  };
}

function normalizeUserReport(value, fallback) {
  if (!value || typeof value !== 'object') {
    return fallback;
  }
  return {
    conclusion: typeof value.conclusion === 'string' ? value.conclusion : fallback.conclusion,
    checked: normalizeStringArray(value.checked, fallback.checked),
    findings: normalizeStringArray(value.findings, fallback.findings),
    plannedChanges: normalizeStringArray(value.plannedChanges, fallback.plannedChanges),
    appliedChanges: normalizeStringArray(value.appliedChanges, fallback.appliedChanges),
    unchangedReason: typeof value.unchangedReason === 'string' ? value.unchangedReason : fallback.unchangedReason,
    nextStep: typeof value.nextStep === 'string' ? value.nextStep : fallback.nextStep
  };
}

function normalizeStringArray(value, fallback = []) {
  if (!Array.isArray(value)) {
    return fallback;
  }
  return value.filter(item => typeof item === 'string');
}

function formatOperationForUserReport(operation) {
  const labels = {
    edit: '编辑',
    create: '新建',
    rename: '重命名',
    move: '移动',
    delete: '删除'
  };
  const label = labels[operation?.type] || operation?.type || '处理';
  const filePath = operation?.path || operation?.to || '未知文件';
  return `${filePath}：${label}`;
}

function collectResultOperations(result) {
  const operations = Array.isArray(result.operations) ? result.operations : [];
  const pendingOperations = Array.isArray(result.pendingOperations) ? result.pendingOperations : [];
  if (!pendingOperations.length) {
    return operations;
  }

  const seen = new Set();
  const combined = [];
  for (const operation of [...operations, ...pendingOperations]) {
    const key = JSON.stringify(operation);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    combined.push(operation);
  }
  return combined;
}

function resolveExternalAgent(env) {
  if (env.CODEX_OVERLEAF_AGENT_FILE) {
    const args = parseAgentArgsJson(env.CODEX_OVERLEAF_AGENT_ARGS_JSON);
    return {
      file: env.CODEX_OVERLEAF_AGENT_FILE,
      args,
      label: [env.CODEX_OVERLEAF_AGENT_FILE, ...args].join(' ')
    };
  }

  if (env.CODEX_OVERLEAF_AGENT_CMD) {
    return {
      command: env.CODEX_OVERLEAF_AGENT_CMD,
      label: env.CODEX_OVERLEAF_AGENT_CMD
    };
  }

  return null;
}

function parseAgentArgsJson(value) {
  if (!value) {
    return [];
  }
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every(item => typeof item === 'string')) {
    throw new Error('CODEX_OVERLEAF_AGENT_ARGS_JSON must be a JSON array of strings');
  }
  return parsed;
}

function runExternalAgent(agentSpec, params, emit = () => {}, options = {}) {
  return new Promise((resolve, reject) => {
    const child = agentSpec.command
      ? spawn(agentSpec.command, {
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })
      : spawn(agentSpec.file, agentSpec.args || [], {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const timeoutMs = parsePositiveInteger(options.timeoutMs, 10 * 60 * 1000);
    const outputMaxBytes = parsePositiveInteger(options.outputMaxBytes, 1024 * 1024);
    let stdout = '';
    let stderr = '';
    let stderrRemainder = '';
    let outputBytes = 0;
    let settled = false;

    const timeout = setTimeout(() => {
      fail(new Error(`Agent command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    function trackOutputBytes(chunk) {
      outputBytes += Buffer.byteLength(String(chunk), 'utf8');
      if (outputBytes > outputMaxBytes) {
        fail(new Error(`Agent output limit exceeded (${outputBytes}/${outputMaxBytes} bytes)`));
        return false;
      }
      return true;
    }

    function fail(error) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (child.exitCode === null && !child.killed) {
        child.kill('SIGTERM');
      }
      reject(error);
    }

    function succeed(result) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    }

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (!trackOutputBytes(chunk) || settled) {
        return;
      }
      stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      if (!trackOutputBytes(chunk) || settled) {
        return;
      }
      const parsed = parseAgentEventLines(`${stderrRemainder}${chunk}`);
      stderrRemainder = parsed.remainder;
      stderr += parsed.stderr;
      for (const event of parsed.events) {
        emitTaskEvent(emit, event.type || 'agent.progress', event.title || event.type || 'Agent progress', event.detail || {}, event.status || 'running');
      }
    });
    child.on('error', fail);
    child.on('close', code => {
      if (settled) {
        return;
      }
      if (stderrRemainder) {
        const parsed = parseAgentEventLines(`${stderrRemainder}\n`);
        stderr += parsed.stderr;
        for (const event of parsed.events) {
          emitTaskEvent(emit, event.type || 'agent.progress', event.title || event.type || 'Agent progress', event.detail || {}, event.status || 'running');
        }
      }

      if (code !== 0) {
        fail(new Error(truncateText(stderr || `Agent command exited with code ${code}`, 12000)));
        return;
      }

      try {
        succeed(JSON.parse(stdout || '{}'));
      } catch (error) {
        fail(new Error(`Agent returned invalid JSON: ${error.message}. stdout=${truncateText(stdout, 4000)}`));
      }
    });

    child.stdin.end(JSON.stringify(params));
  });
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseAgentEventLines(text) {
  const lines = text.split(/\r?\n/);
  const remainder = lines.pop() || '';
  const events = [];
  const stderrLines = [];

  for (const line of lines) {
    if (!line.startsWith('CODEX_OVERLEAF_EVENT ')) {
      stderrLines.push(line);
      continue;
    }

    try {
      events.push(JSON.parse(line.slice('CODEX_OVERLEAF_EVENT '.length)));
    } catch (error) {
      stderrLines.push(`Invalid agent event: ${error.message}`);
    }
  }

  return {
    events,
    stderr: stderrLines.length ? `${stderrLines.join('\n')}\n` : '',
    remainder
  };
}

function emitTaskEvent(emit, type, title, detail = {}, status = 'running') {
  if (typeof emit !== 'function') {
    return;
  }

  emit({
    type,
    title,
    status,
    detail,
    timestamp: new Date().toISOString()
  });
}

function okResponse(id, result) {
  return {
    id,
    ok: true,
    result
  };
}

function errorResponse(id, code, message) {
  return {
    id,
    ok: false,
    error: {
      code,
      message
    }
  };
}

module.exports = {
  buildDefaultTaskResult,
  handleRequest,
  parseAgentEventLines
};
