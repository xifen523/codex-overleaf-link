const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('codex-json-agent removes its temporary project workspace after a run', async () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-fake-bin-'));
  const fakeCodexPath = path.join(binDir, 'codex');
  fs.writeFileSync(fakeCodexPath, [
    '#!/usr/bin/env node',
    'const fs = require("node:fs");',
    'const outputIndex = process.argv.indexOf("--output-last-message");',
    'const outputPath = process.argv[outputIndex + 1];',
    'process.stdin.resume();',
    'process.stdin.on("end", () => {',
    '  fs.writeFileSync(outputPath, JSON.stringify({ status: "completed", notes: "ok", operations: [] }));',
    '});',
    ''
  ].join('\n'), { mode: 0o755 });

  let tempDir = '';
  try {
    const result = await runAgent({
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`
    });
    tempDir = extractTempDir(result.stderr);

    assert.equal(result.code, 0);
    assert.ok(tempDir);
    assert.equal(fs.existsSync(tempDir), false);
  } finally {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    fs.rmSync(binDir, { recursive: true, force: true });
  }
});

test('codex-json-agent forwards Codex JSONL agent messages and commands as realtime events', async () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-fake-bin-'));
  const fakeCodexPath = path.join(binDir, 'codex');
  fs.writeFileSync(fakeCodexPath, [
    '#!/usr/bin/env node',
    'const fs = require("node:fs");',
    'const outputIndex = process.argv.indexOf("--output-last-message");',
    'const outputPath = process.argv[outputIndex + 1];',
    'if (!process.argv.includes("--json")) process.exit(7);',
    'process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "I will inspect main.tex first." } }) + "\\n");',
    'process.stdout.write(JSON.stringify({ type: "item.started", item: { type: "command_execution", command: "rg citation main.tex", status: "in_progress" } }) + "\\n");',
    'process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "rg citation main.tex", aggregated_output: "1:citation", exit_code: 0, status: "completed" } }) + "\\n");',
    'process.stdin.resume();',
    'process.stdin.on("end", () => {',
    '  fs.writeFileSync(outputPath, JSON.stringify({ status: "completed", notes: "ok", operations: [] }));',
    '});',
    ''
  ].join('\n'), { mode: 0o755 });

  try {
    const result = await runAgent({
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`
    });
    const events = extractEvents(result.stderr);

    assert.equal(result.code, 0);
    assert.equal(events.some(event => event.type === 'codex.agent.message' && /inspect main\.tex/.test(event.detail?.text || '')), true);
    assert.equal(events.some(event => event.type === 'codex.command.started' && /rg citation/.test(event.detail?.command || '')), true);
    assert.equal(events.some(event => event.type === 'codex.command.completed' && /1:citation/.test(event.detail?.output || '')), true);
  } finally {
    fs.rmSync(binDir, { recursive: true, force: true });
  }
});

function runAgent(envPatch) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(__dirname, '../scripts/codex-json-agent.mjs')
    ], {
      env: {
        ...process.env,
        ...envPatch
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', code => {
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(JSON.stringify({
      task: 'No-op',
      project: {
        files: [
          { path: 'main.tex', content: 'hello' }
        ]
      }
    }));
  });
}

function extractTempDir(stderr) {
  for (const event of extractEvents(stderr)) {
    if (event.type === 'agent.snapshot.ready') {
      return event.detail?.tempDir || '';
    }
  }
  return '';
}

function extractEvents(stderr) {
  const events = [];
  for (const line of stderr.split(/\r?\n/)) {
    if (!line.startsWith('CODEX_OVERLEAF_EVENT ')) {
      continue;
    }
    const event = JSON.parse(line.slice('CODEX_OVERLEAF_EVENT '.length));
    events.push(event);
  }
  return events;
}
