'use strict';

// Parallel-subagents broker (v1.6, spec: docs/superpowers/specs/
// 2026-06-10-v1.6-parallel-subagents-design.md).
//
// The sandboxed model cannot spawn processes (Seatbelt kills nested Codex at
// client init — verified empirically), but it CAN write workspace files. The
// broker runs in the native host (outside the sandbox), watches a file-based
// job queue inside the mirror workspace, and fans each accepted job out to a
// real sibling Codex run via an injected `runWorkerTask`. Ownership of files
// is disjoint by protocol; violations are attributed at wave level and the
// runner hard-blocks them from writeback (spec S5/S8).
//
// Everything time- or process-shaped is injectable so the unit suite can run
// with fake workers and millisecond limits.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { SUBAGENT_QUEUE_DIR } = require('./mirrorWorkspace');

const PROTOCOL_VERSION = 1;
const JOB_ID_PATTERN = /^[a-z0-9-]{1,32}$/;
const MAX_JOB_FILE_BYTES = 32 * 1024;
const SUMMARY_LIMIT_CHARS = 2048;

const DEFAULT_LIMITS = Object.freeze({
  maxWorkers: 3,
  maxJobsPerRun: 8,
  perWorkerTimeoutMs: 300000,
  brokerBudgetMs: 900000,
  pollIntervalMs: 500,
  drainGraceMs: 30000
});

function createSubagentBroker(options = {}) {
  const workspacePath = options.workspacePath;
  if (!workspacePath) {
    throw new Error('subagent broker requires a workspacePath');
  }
  const runWorkerTask = options.runWorkerTask;
  if (typeof runWorkerTask !== 'function') {
    throw new Error('subagent broker requires a runWorkerTask function');
  }
  const emit = typeof options.emit === 'function' ? options.emit : () => {};
  const onMirrorDirty = typeof options.onMirrorDirty === 'function' ? options.onMirrorDirty : () => {};
  const parentSignal = options.signal || null;
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };

  const queueRoot = path.join(workspacePath, SUBAGENT_QUEUE_DIR);
  const jobsDir = path.join(queueRoot, 'jobs');
  const resultsDir = path.join(queueRoot, 'results');
  const logsDir = path.join(queueRoot, 'logs');

  const jobs = new Map(); // id -> { job, status, startedAt, ownedBefore }
  const seenFiles = new Set();
  const violations = [];
  const violationPaths = new Set();
  let queued = [];
  let running = new Map(); // id -> { controller, deadlineTimer, promise }
  let acceptedCount = 0;
  let startedAt = 0;
  let accepting = false;
  let pollTimer = null;
  let waveIndex = 0;
  let waveSnapshot = null; // { hashes: Map(path->hash), ownedUnion: Set, jobIds: [] }
  let anyWorkerStarted = false;
  let cancelled = false;
  let closed = false;

  function start() {
    // Stale queue dirs from a previous run carry old results/logs — clear
    // them so the model never reads another run's state (spec S9).
    fs.rmSync(queueRoot, { recursive: true, force: true });
    fs.mkdirSync(jobsDir, { recursive: true });
    fs.mkdirSync(resultsDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });
    fs.mkdirSync(path.join(queueRoot, 'work'), { recursive: true });
    startedAt = Date.now();
    accepting = true;
    writeBrokerFile('ready');
    pollTimer = setInterval(pollOnce, limits.pollIntervalMs);
    if (parentSignal) {
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
  }

  function writeBrokerFile(status) {
    const payload = {
      protocolVersion: PROTOCOL_VERSION,
      status,
      maxWorkers: limits.maxWorkers,
      maxJobsPerRun: limits.maxJobsPerRun,
      perWorkerTimeoutMs: limits.perWorkerTimeoutMs,
      brokerBudgetMs: limits.brokerBudgetMs,
      acceptedUntil: new Date(startedAt + limits.brokerBudgetMs - limits.perWorkerTimeoutMs).toISOString()
    };
    atomicWrite(path.join(queueRoot, 'broker.json'), JSON.stringify(payload, null, 2));
  }

  function atomicWrite(target, text) {
    const tmp = path.join(path.dirname(target), `.tmp-${crypto.randomUUID()}`);
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, target);
  }

  function pollOnce() {
    if (closed || cancelled) {
      return;
    }
    try {
      intakeJobs();
      fillSlots();
    } catch (_error) {
      // The queue is adversarial model output; the broker never throws on it.
    }
  }

  function intakeJobs() {
    if (!accepting || !fs.existsSync(jobsDir)) {
      return;
    }
    for (const name of fs.readdirSync(jobsDir).sort()) {
      if (!name.endsWith('.json') || name.startsWith('.tmp-') || seenFiles.has(name)) {
        continue;
      }
      seenFiles.add(name);
      admitJobFile(name);
    }
  }

  function admitJobFile(name) {
    const filePath = path.join(jobsDir, name);
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch (_error) {
      return;
    }
    if (stat.size > MAX_JOB_FILE_BYTES) {
      return writeRejection({ id: idFromFileName(name), reason: 'job_too_large' });
    }
    let job;
    try {
      job = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_error) {
      return writeRejection({ id: idFromFileName(name), reason: 'invalid_json' });
    }
    const rejection = validateJob(job);
    if (rejection) {
      return writeRejection({ id: jobIdOrFallback(job, name), ...rejection });
    }
    acceptedCount += 1;
    jobs.set(job.id, { job, status: 'queued' });
    queued.push(job.id);
    emit('codex.subagent.queued', job.title || job.id, { jobId: job.id, files: job.files }, 'running');
  }

  function idFromFileName(name) {
    return name.replace(/\.json$/, '').slice(0, 32) || 'unknown';
  }

  function jobIdOrFallback(job, name) {
    return typeof job?.id === 'string' && job.id ? job.id.slice(0, 32) : idFromFileName(name);
  }

  function validateJob(job) {
    if (!job || typeof job !== 'object') {
      return { reason: 'invalid_json' };
    }
    if (typeof job.id !== 'string' || !JOB_ID_PATTERN.test(job.id)) {
      return { reason: 'invalid_id' };
    }
    if (jobs.has(job.id)) {
      return { reason: 'duplicate_id' };
    }
    if (acceptedCount >= limits.maxJobsPerRun) {
      return { reason: 'too_many_jobs' };
    }
    if (typeof job.task !== 'string' || !job.task.trim()) {
      return { reason: 'missing_task' };
    }
    if (!Array.isArray(job.files) || !job.files.length) {
      return { reason: 'missing_files' };
    }
    const owned = [];
    for (const file of job.files) {
      const safe = safeWorkspaceRelativePath(file);
      if (!safe) {
        return { reason: 'unsafe_path', path: String(file) };
      }
      if (!fs.existsSync(path.join(workspacePath, safe))) {
        return { reason: 'missing_file', path: safe };
      }
      owned.push(safe);
    }
    // Overlapping ownership no longer rejects: same-file jobs are admitted
    // and SERIALIZED by the scheduler (fillSlots never runs two jobs whose
    // files intersect). Prompt-scoped same-file delegation is then safe —
    // the physical lost-update race only exists under concurrency (v1.6.1).
    // Wave-aware admission: the parent turn has no default absolute deadline,
    // so the broker enforces its own wall-clock envelope across ALL waves.
    const projectedWaves = Math.ceil((queued.length + running.size + 1) / limits.maxWorkers);
    if (Date.now() + projectedWaves * limits.perWorkerTimeoutMs > startedAt + limits.brokerBudgetMs) {
      return { reason: 'insufficient_time' };
    }
    job.files = owned;
    job.readOnlyContext = Array.isArray(job.readOnlyContext)
      ? job.readOnlyContext.map(safeWorkspaceRelativePath).filter(Boolean)
      : [];
    return null;
  }

  function safeWorkspaceRelativePath(value) {
    if (typeof value !== 'string' || !value.trim()) {
      return null;
    }
    const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalized || path.isAbsolute(normalized)) {
      return null;
    }
    const segments = normalized.split('/');
    if (segments.some(segment => segment === '..' || segment === '')) {
      return null;
    }
    if (segments[0] === SUBAGENT_QUEUE_DIR) {
      // The queue control plane (jobs/results/logs/broker.json) is never
      // ownable — but the work/ scratch zone IS: single-file fan-out slices
      // live there (v1.6.1 scatter-gather), excluded from writeback by the
      // mirror-scan rule yet fully owned/hashed like any other job file.
      if (segments[1] === 'work' && segments.length >= 3) {
        return segments.join('/');
      }
      return null;
    }
    return segments.join('/');
  }

  function writeRejection(input) {
    const result = {
      id: input.id,
      status: 'rejected',
      reason: input.reason,
      path: input.path,
      conflictsWith: input.conflictsWith
    };
    writeResult(result);
    emit('codex.subagent.rejected', input.id, result, 'warning');
  }

  function writeResult(result) {
    atomicWrite(path.join(resultsDir, `${result.id}.json`), JSON.stringify(result, null, 2));
  }

  function fillSlots() {
    while (accepting && !cancelled && queued.length && running.size < limits.maxWorkers) {
      const runningFiles = new Set();
      for (const id of running.keys()) {
        for (const file of jobs.get(id).job.files) {
          runningFiles.add(file);
        }
      }
      // FIFO with skip: pick the first queued job whose ownership does not
      // intersect any running job's files — overlapping jobs wait their turn
      // (temporal exclusivity replaces the old overlap rejection).
      const index = queued.findIndex(id => !jobs.get(id).job.files.some(file => runningFiles.has(file)));
      if (index === -1) {
        return;
      }
      const [jobId] = queued.splice(index, 1);
      const entry = jobs.get(jobId);
      try {
        startWorker(entry);
      } catch (error) {
        // A job is spliced out of `queued` before it starts; if startWorker
        // throws it would vanish with no result, hanging a lead still polling
        // for its count. Emit a failed result so the poll loop can proceed.
        if (entry) {
          entry.status = 'failed';
        }
        appendLog(jobId, `start_failed: ${error?.stack || error?.message || String(error)}`);
        try {
          writeResult({ id: jobId, status: 'failed', reason: error?.message || 'subagent failed to start' });
        } catch (_writeError) { /* result dir may be gone */ }
      }
    }
  }

  function startWorker(entry) {
    const { job } = entry;
    if (running.size === 0) {
      beginWave();
    }
    anyWorkerStarted = true;
    entry.status = 'running';
    entry.startedAt = Date.now();
    entry.wave = waveIndex;
    entry.ownedBefore = hashPaths(job.files);
    waveSnapshot.jobIds.push(job.id);
    for (const file of job.files) {
      waveSnapshot.ownedUnion.add(file);
    }

    const controller = new AbortController();
    let timedOut = false;
    const deadlineTimer = setTimeout(() => {
      // Broker-owned wall-clock deadline (spec P1-5 fix): the runner's
      // absolute timeout is an opt-in env override and the idle watchdog
      // never fires on a chatty-but-stuck worker, so the broker is the only
      // component positioned to bound worker wall-clock time.
      timedOut = true;
      controller.abort(new Error('subagent timeout'));
    }, limits.perWorkerTimeoutMs);

    emit('codex.subagent.started', job.title || job.id, {
      jobId: job.id,
      files: job.files,
      activeWorkers: running.size + 1,
      maxWorkers: limits.maxWorkers
    }, 'running');

    const promise = runWorkerTask({
      jobId: job.id,
      prompt: buildWorkerPrompt(job),
      signal: controller.signal
    }).then(workerResult => {
      finishWorker(entry, {
        status: 'completed',
        summary: String(workerResult?.assistantMessage || '').slice(0, SUMMARY_LIMIT_CHARS),
        tokensUsed: workerResult?.tokensUsed
      }, workerResult);
    }).catch(error => {
      // Any broker-initiated abort that is not the wall-clock deadline
      // (parent cancel, drain) reads as 'cancelled'; only genuine worker
      // errors read as 'failed'.
      const status = timedOut ? 'timeout' : controller.signal.aborted ? 'cancelled' : 'failed';
      appendLog(job.id, `${status}: ${error?.stack || error?.message || String(error)}`);
      finishWorker(entry, { status, reason: error?.message || String(error) });
    }).finally(() => {
      clearTimeout(deadlineTimer);
      running.delete(job.id);
      if (running.size === 0) {
        endWave();
      }
      fillSlots();
    });

    running.set(job.id, { controller, deadlineTimer, promise });
  }

  function finishWorker(entry, resultFields, workerResult) {
    const { job } = entry;
    entry.status = resultFields.status;
    const ownedAfter = hashPaths(job.files);
    const changedFiles = job.files.filter(file => entry.ownedBefore.get(file) !== ownedAfter.get(file));
    if (resultFields.status !== 'completed' && changedFiles.length) {
      // A worker that did not finish cleanly (timeout / cancelled / failed)
      // may have left a half-written file on disk. The mirror scan would
      // otherwise ship that partial edit straight to Overleaf, so withhold it
      // the same way ownership violations are withheld — the runner's S8
      // demotion reads getViolationPaths() and drops these from writeback
      // (spec S8 safety extension, v1.6.2).
      for (const file of changedFiles) {
        violationPaths.add(file);
      }
    }
    const result = {
      id: job.id,
      ...resultFields,
      changedFiles,
      durationMs: Date.now() - entry.startedAt
    };
    entry.result = result;
    writeResult(result);
    if (resultFields.status === 'completed' && workerResult?.assistantMessage) {
      atomicWrite(path.join(resultsDir, `${job.id}.last-message.md`), String(workerResult.assistantMessage));
    }
    const eventType = resultFields.status === 'completed' ? 'codex.subagent.completed' : 'codex.subagent.failed';
    emit(eventType, job.title || job.id, {
      jobId: job.id,
      status: resultFields.status,
      reason: resultFields.reason,
      changedFiles,
      durationMs: result.durationMs
    }, resultFields.status === 'completed' ? 'completed' : 'warning');
  }

  function appendLog(jobId, text) {
    try {
      fs.appendFileSync(path.join(logsDir, `${jobId}.log`), `${new Date().toISOString()} ${text}\n`);
    } catch (_error) { /* logs are best-effort */ }
  }

  // ---- wave tracking (spec S5): owned attribution is per worker; unowned
  // changes can only be attributed to the wave's set of suspects.
  function beginWave() {
    waveIndex += 1;
    waveSnapshot = {
      hashes: hashWorkspace(),
      ownedUnion: new Set(),
      jobIds: []
    };
  }

  function endWave() {
    if (!waveSnapshot) {
      return;
    }
    const after = hashWorkspace();
    const before = waveSnapshot.hashes;
    const changed = new Set();
    for (const [file, hash] of after) {
      if (before.get(file) !== hash) {
        changed.add(file);
      }
    }
    for (const file of before.keys()) {
      if (!after.has(file)) {
        changed.add(file);
      }
    }
    for (const file of changed) {
      if (waveSnapshot.ownedUnion.has(file)) {
        continue;
      }
      const violation = {
        path: file,
        wave: waveIndex,
        suspects: [...waveSnapshot.jobIds, 'parent']
      };
      violations.push(violation);
      violationPaths.add(file);
      emit('codex.subagent.violation', file, violation, 'warning');
    }
    waveSnapshot = null;
  }

  function hashWorkspace() {
    const hashes = new Map();
    walk(workspacePath, '');
    return hashes;

    function walk(dir, prefix) {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (_error) {
        return;
      }
      for (const entry of entries) {
        // The whole queue zone (incl. the work/ slice scratch) stays out of
        // wave hashing: scratch can never reach Overleaf, same-wave slices
        // are all in the owned union anyway, and a lead staggering slice
        // creation mid-wave must not read as a violation (v1.6.1).
        if (entry.name === '.DS_Store' || entry.name === SUBAGENT_QUEUE_DIR || entry.name === '.codex-overleaf-attachments') {
          continue;
        }
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(absolute, relative);
        } else if (entry.isFile()) {
          hashes.set(relative, hashFile(absolute));
        }
      }
    }
  }

  function hashPaths(files) {
    const hashes = new Map();
    for (const file of files) {
      hashes.set(file, hashFile(path.join(workspacePath, file)));
    }
    return hashes;
  }

  function hashFile(absolute) {
    try {
      return crypto.createHash('sha1').update(fs.readFileSync(absolute)).digest('hex');
    } catch (_error) {
      return 'missing';
    }
  }

  function buildWorkerPrompt(job) {
    const readOnly = job.readOnlyContext.length
      ? `- You may read these for context but must not modify them: ${job.readOnlyContext.join(', ')}.\n`
      : '';
    return [
      'You are a subagent working on one slice of a larger task.',
      'HARD CONSTRAINTS:',
      `- You may modify ONLY these files: ${job.files.join(', ')}.`,
      readOnly + '- Do not modify, create, or delete any other file. Inside .codex-overleaf-subagents/ you may touch ONLY the slice files listed above (if any).',
      '- Work fully autonomously; nobody can answer questions.',
      '',
      job.task
    ].join('\n');
  }

  function onParentAbort() {
    cancelled = true;
    accepting = false;
    for (const { controller } of running.values()) {
      controller.abort(new Error('run cancelled'));
    }
    for (const jobId of queued.splice(0)) {
      const entry = jobs.get(jobId);
      entry.status = 'cancelled';
      writeResult({ id: jobId, status: 'cancelled', reason: 'run cancelled' });
    }
    if (anyWorkerStarted) {
      // Partial worker edits must be deterministically discarded: cancellation
      // already skips writeback, and the dirty mark forces the next run's
      // mirror sync to rebuild the workspace from Overleaf (spec P1-3 fix).
      onMirrorDirty();
    }
    close();
  }

  async function stop({ drain = true } = {}) {
    accepting = false;
    // Queued-but-unstarted jobs would otherwise vanish with no result file,
    // hanging a lead still polling for its job count. Settle them first
    // (mirrors onParentAbort's queue handling).
    for (const jobId of queued.splice(0)) {
      const entry = jobs.get(jobId);
      if (entry) {
        entry.status = 'cancelled';
      }
      writeResult({ id: jobId, status: 'cancelled', reason: 'The run ended before this subagent started.' });
    }
    if (drain && running.size) {
      let graceTimer = null;
      const grace = new Promise(resolve => {
        graceTimer = setTimeout(resolve, limits.drainGraceMs);
      });
      await Promise.race([
        Promise.allSettled([...running.values()].map(worker => worker.promise)),
        grace
      ]);
      // The grace timer gates an awaited race; if the workers settled first it
      // must be cleared or it keeps the event loop alive for drainGraceMs
      // (the "keep timers gated, then clear" discipline from c3cd357).
      if (graceTimer) {
        clearTimeout(graceTimer);
      }
    }
    for (const { controller } of running.values()) {
      controller.abort(new Error('broker drained'));
    }
    // Bounded final settle: a worker that ignores its abort must not hang
    // stop() forever — that strands codex.run and leaks the project lock (the
    // very zombie-lock case handleCodexCancel exists to recover from).
    await settleRunningWithin(limits.drainGraceMs);
    if (jobs.size) {
      emit('codex.subagent.drained', 'subagents drained', {
        jobs: jobs.size,
        violations: violations.length
      }, 'completed');
    }
    close();
  }

  async function settleRunningWithin(timeoutMs) {
    if (!running.size) {
      return;
    }
    let timer = null;
    const fallback = new Promise(resolve => {
      timer = setTimeout(resolve, Math.max(0, timeoutMs));
    });
    await Promise.race([
      Promise.allSettled([...running.values()].map(worker => worker.promise)),
      fallback
    ]);
    if (timer) {
      clearTimeout(timer);
    }
  }

  function close() {
    if (closed) {
      return;
    }
    closed = true;
    if (pollTimer) {
      clearInterval(pollTimer);
    }
    parentSignal?.removeEventListener?.('abort', onParentAbort);
    try {
      writeBrokerFile('closed');
    } catch (_error) { /* workspace may already be gone */ }
  }

  return {
    start,
    stop,
    pollOnce,
    hasActiveWorkers: () => running.size > 0,
    hasAcceptedJobs: () => jobs.size > 0,
    getViolationPaths: () => new Set(violationPaths),
    getAuditSummary: () => ({
      jobs: [...jobs.values()].map(entry => ({
        id: entry.job?.id,
        title: entry.job?.title,
        files: entry.job?.files,
        status: entry.status,
        reason: entry.result?.reason,
        durationMs: entry.result?.durationMs
      })),
      violations: violations.slice()
    })
  };
}

module.exports = {
  createSubagentBroker,
  SUBAGENT_QUEUE_DIR,
  DEFAULT_SUBAGENT_LIMITS: DEFAULT_LIMITS
};
