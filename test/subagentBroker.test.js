const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createSubagentBroker, SUBAGENT_QUEUE_DIR } = require('../native-host/src/subagentBroker');

const TINY = { maxWorkers: 2, maxJobsPerRun: 4, perWorkerTimeoutMs: 120, brokerBudgetMs: 5000, pollIntervalMs: 5, drainGraceMs: 40 };

function makeWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-broker-'));
  fs.mkdirSync(path.join(dir, 'sections'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'main.tex'), 'main');
  fs.writeFileSync(path.join(dir, 'sections', 'ch1.tex'), 'one');
  fs.writeFileSync(path.join(dir, 'sections', 'ch2.tex'), 'two');
  return dir;
}

function queue(dir) {
  return path.join(dir, SUBAGENT_QUEUE_DIR);
}

function writeJob(dir, job) {
  const jobsDir = path.join(queue(dir), 'jobs');
  const tmp = path.join(jobsDir, `.tmp-${job.id || 'x'}`);
  fs.writeFileSync(tmp, typeof job === 'string' ? job : JSON.stringify(job));
  fs.renameSync(tmp, path.join(jobsDir, `${job.id || 'raw'}.json`));
}

function readResult(dir, id) {
  const file = path.join(queue(dir), 'results', `${id}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

async function waitFor(predicate, ms = 2000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('waitFor timed out');
}

function abortableWorker(impl) {
  return ({ jobId, prompt, signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason || new Error('aborted')), { once: true });
    Promise.resolve(impl({ jobId, prompt, signal })).then(resolve, reject);
  });
}

test('broker start writes a ready handshake and clears stale queues', async () => {
  const dir = makeWorkspace();
  fs.mkdirSync(path.join(queue(dir), 'results'), { recursive: true });
  fs.writeFileSync(path.join(queue(dir), 'results', 'stale.json'), '{}');
  const broker = createSubagentBroker({ workspacePath: dir, runWorkerTask: async () => ({}), limits: TINY });
  broker.start();
  const handshake = JSON.parse(fs.readFileSync(path.join(queue(dir), 'broker.json'), 'utf8'));
  assert.equal(handshake.status, 'ready');
  assert.equal(handshake.protocolVersion, 1);
  assert.equal(handshake.maxWorkers, TINY.maxWorkers);
  assert.equal(fs.existsSync(path.join(queue(dir), 'results', 'stale.json')), false, 'stale results cleared');
  await broker.stop();
  assert.equal(JSON.parse(fs.readFileSync(path.join(queue(dir), 'broker.json'), 'utf8')).status, 'closed');
});

test('accepted job runs, edits its owned file, and lands a completed result', async () => {
  const dir = makeWorkspace();
  const events = [];
  const prompts = [];
  const broker = createSubagentBroker({
    workspacePath: dir,
    emit: (type, title, detail, status) => events.push({ type, title, status }),
    runWorkerTask: abortableWorker(async ({ jobId, prompt }) => {
      prompts.push(prompt);
      fs.writeFileSync(path.join(dir, 'sections', 'ch1.tex'), 'polished one');
      return { assistantMessage: `done ${jobId}`, tokensUsed: 12 };
    }),
    limits: TINY
  });
  broker.start();
  writeJob(dir, { id: 'ch1', title: 'Polish chapter 1', task: 'polish it', files: ['sections/ch1.tex'], readOnlyContext: ['main.tex'] });
  await waitFor(() => readResult(dir, 'ch1')?.status === 'completed');
  const result = readResult(dir, 'ch1');
  assert.equal(result.summary, 'done ch1');
  assert.deepEqual(result.changedFiles, ['sections/ch1.tex']);
  assert.match(fs.readFileSync(path.join(queue(dir), 'results', 'ch1.last-message.md'), 'utf8'), /done ch1/);
  // worker prompt carries the ownership envelope
  assert.match(prompts[0], /modify ONLY these files: sections\/ch1\.tex/);
  assert.match(prompts[0], /must not modify them: main\.tex/);
  assert.match(prompts[0], /Do not touch \.codex-overleaf-subagents\//);
  assert.deepEqual(events.map(e => e.type), ['codex.subagent.queued', 'codex.subagent.started', 'codex.subagent.completed']);
  // no torn temp files left behind
  assert.equal(fs.readdirSync(path.join(queue(dir), 'results')).filter(n => n.startsWith('.tmp-')).length, 0);
  await broker.stop();
});

test('validation rejects bad ids, garbage json, unsafe paths, missing files, conflicts, and over-cap jobs', async () => {
  const dir = makeWorkspace();
  const broker = createSubagentBroker({
    workspacePath: dir,
    runWorkerTask: abortableWorker(() => new Promise(() => {})),
    limits: { ...TINY, maxWorkers: 1, maxJobsPerRun: 2, perWorkerTimeoutMs: 1000, brokerBudgetMs: 60000 }
  });
  broker.start();
  fs.writeFileSync(path.join(queue(dir), 'jobs', 'raw.json'), 'not json');
  writeJob(dir, { id: 'BAD ID', task: 't', files: ['main.tex'] });
  writeJob(dir, { id: 'esc', task: 't', files: ['../outside.tex'] });
  writeJob(dir, { id: 'ghost', task: 't', files: ['nope.tex'] });
  // intake order is alphabetical over jobs/, so 'aa-ok' is admitted before
  // 'clash' contends for the same file
  writeJob(dir, { id: 'aa-ok', task: 't', files: ['sections/ch1.tex'] });
  writeJob(dir, { id: 'clash', task: 't', files: ['sections/ch1.tex'] });
  writeJob(dir, { id: 'ok-b', task: 't', files: ['sections/ch2.tex'] });
  writeJob(dir, { id: 'zz-over', task: 't', files: ['main.tex'] });
  await waitFor(() => readResult(dir, 'zz-over'));
  assert.equal(readResult(dir, 'raw').reason, 'invalid_json');
  assert.equal(readResult(dir, 'BAD ID')?.reason ?? 'invalid_id', 'invalid_id');
  assert.equal(readResult(dir, 'esc').reason, 'unsafe_path');
  assert.equal(readResult(dir, 'ghost').reason, 'missing_file');
  assert.equal(readResult(dir, 'clash').reason, 'file_conflict');
  assert.equal(readResult(dir, 'clash').conflictsWith, 'aa-ok');
  assert.equal(readResult(dir, 'zz-over').reason, 'too_many_jobs');
  await broker.stop({ drain: false });
});

test('wave-aware admission rejects jobs that cannot fit the broker budget', async () => {
  const dir = makeWorkspace();
  const broker = createSubagentBroker({
    workspacePath: dir,
    runWorkerTask: abortableWorker(() => new Promise(() => {})),
    limits: { ...TINY, maxWorkers: 1, maxJobsPerRun: 8, perWorkerTimeoutMs: 400, brokerBudgetMs: 500 }
  });
  broker.start();
  writeJob(dir, { id: 'first', task: 't', files: ['sections/ch1.tex'] });
  writeJob(dir, { id: 'second', task: 't', files: ['sections/ch2.tex'] });
  await waitFor(() => readResult(dir, 'second'));
  // first fits (1 wave * 400 <= 500); second would need a second wave (800 > 500)
  assert.equal(readResult(dir, 'first'), null);
  assert.equal(readResult(dir, 'second').reason, 'insufficient_time');
  await broker.stop({ drain: false });
});

test('concurrency stays under maxWorkers across waves', async () => {
  const dir = makeWorkspace();
  let active = 0;
  let peak = 0;
  const broker = createSubagentBroker({
    workspacePath: dir,
    runWorkerTask: abortableWorker(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 25));
      active -= 1;
      return { assistantMessage: 'ok' };
    }),
    limits: { ...TINY, maxWorkers: 2, perWorkerTimeoutMs: 5000, brokerBudgetMs: 60000 }
  });
  broker.start();
  writeJob(dir, { id: 'a', task: 't', files: ['sections/ch1.tex'] });
  writeJob(dir, { id: 'b', task: 't', files: ['sections/ch2.tex'] });
  writeJob(dir, { id: 'c', task: 't', files: ['main.tex'] });
  await waitFor(() => ['a', 'b', 'c'].every(id => readResult(dir, id)?.status === 'completed'));
  assert.equal(peak, 2, 'never more than maxWorkers concurrent');
  await broker.stop();
});

test('a chatty-but-never-completing worker is killed at the wall-clock deadline', async () => {
  const dir = makeWorkspace();
  const broker = createSubagentBroker({
    workspacePath: dir,
    // emits forever, never resolves — only the broker deadline can stop it
    runWorkerTask: abortableWorker(() => new Promise(() => {
      setInterval(() => {}, 5).unref();
    })),
    limits: { ...TINY, perWorkerTimeoutMs: 60 }
  });
  broker.start();
  writeJob(dir, { id: 'stuck', task: 't', files: ['sections/ch1.tex'] });
  await waitFor(() => readResult(dir, 'stuck'));
  assert.equal(readResult(dir, 'stuck').status, 'timeout');
  await broker.stop({ drain: false });
});

test('parent cancel aborts workers, cancels queued jobs, and marks the mirror dirty exactly once', async () => {
  const dir = makeWorkspace();
  const controller = new AbortController();
  let dirtyCalls = 0;
  const broker = createSubagentBroker({
    workspacePath: dir,
    signal: controller.signal,
    onMirrorDirty: () => { dirtyCalls += 1; },
    runWorkerTask: abortableWorker(() => new Promise(() => {})),
    limits: { ...TINY, maxWorkers: 1, perWorkerTimeoutMs: 5000, brokerBudgetMs: 60000 }
  });
  broker.start();
  writeJob(dir, { id: 'run-a', task: 't', files: ['sections/ch1.tex'] });
  writeJob(dir, { id: 'wait-b', task: 't', files: ['sections/ch2.tex'] });
  await waitFor(() => broker.hasActiveWorkers());
  controller.abort(new Error('user cancelled'));
  await waitFor(() => readResult(dir, 'run-a') && readResult(dir, 'wait-b'));
  assert.equal(readResult(dir, 'run-a').status, 'cancelled');
  assert.equal(readResult(dir, 'wait-b').status, 'cancelled');
  assert.equal(dirtyCalls, 1, 'markMirrorDirty hook fires once');
  assert.equal(JSON.parse(fs.readFileSync(path.join(queue(dir), 'broker.json'), 'utf8')).status, 'closed');
});

test('stop({drain}) gives workers a grace window then aborts the stragglers', async () => {
  const dir = makeWorkspace();
  const broker = createSubagentBroker({
    workspacePath: dir,
    runWorkerTask: abortableWorker(async ({ jobId }) => {
      if (jobId === 'quick') {
        await new Promise(resolve => setTimeout(resolve, 10));
        return { assistantMessage: 'quick done' };
      }
      return new Promise(() => {});
    }),
    limits: { ...TINY, perWorkerTimeoutMs: 5000, brokerBudgetMs: 60000, drainGraceMs: 40 }
  });
  broker.start();
  writeJob(dir, { id: 'quick', task: 't', files: ['sections/ch1.tex'] });
  writeJob(dir, { id: 'slow', task: 't', files: ['sections/ch2.tex'] });
  await waitFor(() => broker.hasActiveWorkers());
  await broker.stop({ drain: true });
  assert.equal(readResult(dir, 'quick').status, 'completed');
  assert.equal(readResult(dir, 'slow').status, 'cancelled');
});

test('unowned changes during a wave become wave-level violations with suspects', async () => {
  const dir = makeWorkspace();
  const events = [];
  const broker = createSubagentBroker({
    workspacePath: dir,
    emit: (type, title, detail) => events.push({ type, detail }),
    runWorkerTask: abortableWorker(async ({ jobId }) => {
      fs.writeFileSync(path.join(dir, 'sections', 'ch1.tex'), 'mine');
      // rogue edit: a file NO job owns
      fs.writeFileSync(path.join(dir, 'main.tex'), 'rogue edit');
      return { assistantMessage: `done ${jobId}` };
    }),
    limits: TINY
  });
  broker.start();
  writeJob(dir, { id: 'ch1', title: 'ch1', task: 't', files: ['sections/ch1.tex'] });
  await waitFor(() => readResult(dir, 'ch1')?.status === 'completed');
  await waitFor(() => broker.getViolationPaths().has('main.tex'));
  const violation = broker.getAuditSummary().violations[0];
  assert.equal(violation.path, 'main.tex');
  assert.deepEqual(violation.suspects, ['ch1', 'parent'], 'wave-level attribution: suspects, not a named actor');
  assert.ok(events.some(e => e.type === 'codex.subagent.violation'));
  await broker.stop();
});

test('audit summary captures jobs, statuses, and violations without task text', async () => {
  const dir = makeWorkspace();
  const broker = createSubagentBroker({
    workspacePath: dir,
    runWorkerTask: abortableWorker(async () => ({ assistantMessage: 'ok' })),
    limits: TINY
  });
  broker.start();
  writeJob(dir, { id: 'ch1', title: 'Polish ch1', task: 'SECRET TASK TEXT', files: ['sections/ch1.tex'] });
  await waitFor(() => readResult(dir, 'ch1')?.status === 'completed');
  await broker.stop();
  const summary = broker.getAuditSummary();
  assert.equal(summary.jobs[0].id, 'ch1');
  assert.equal(summary.jobs[0].status, 'completed');
  assert.equal(JSON.stringify(summary).includes('SECRET TASK TEXT'), false);
});
