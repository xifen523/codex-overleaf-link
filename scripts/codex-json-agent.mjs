#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildCodexPrompt, buildOutputSchema } = require('../native-host/src/codexPrompt');
const { buildCodexExecArgs } = require('../native-host/src/codexArgs');

const input = await readStdin();
const request = JSON.parse(input || '{}');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-agent-'));
const schemaPath = path.join(tempDir, 'output-schema.json');
const outputPath = path.join(tempDir, 'last-message.json');

try {
  emitEvent('agent.snapshot.preparing', 'Preparing project snapshot for Codex', {
    fileCount: request.project?.files?.length || 0,
    totalChars: (request.project?.files || []).reduce((sum, file) => sum + String(file?.content || '').length, 0)
  });
  fs.writeFileSync(schemaPath, JSON.stringify(buildOutputSchema(), null, 2), 'utf8');
  writeSnapshotFiles(tempDir, request.project?.files || []);
  emitEvent('agent.snapshot.ready', 'Project snapshot written to temp workspace', {
    tempDir,
    fileCount: request.project?.files?.length || 0
  });

  const prompt = buildCodexPrompt(request);
  emitEvent('codex.prompt.ready', 'Codex prompt prepared', {
    taskLength: String(request.task || '').length,
    promptLength: prompt.length,
    model: request.model,
    reasoningEffort: request.reasoningEffort,
    speedTier: request.speedTier
  });
  const result = await runCodexExec({
    cwd: tempDir,
    prompt,
    schemaPath,
    outputPath,
    model: request.model,
    reasoningEffort: request.reasoningEffort,
    speedTier: request.speedTier
  });

  process.stdout.write(JSON.stringify(result));
} finally {
  if (process.env.CODEX_OVERLEAF_KEEP_TEMP !== '1') {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function emitEvent(type, title, detail = {}, status = 'running') {
  process.stderr.write(`CODEX_OVERLEAF_EVENT ${JSON.stringify({
    type,
    title,
    status,
    detail,
    timestamp: new Date().toISOString()
  })}\n`);
}

function readStdin() {
  return new Promise(resolve => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
  });
}

function writeSnapshotFiles(root, files) {
  for (const file of files) {
    if (!file?.path || typeof file.content !== 'string') {
      continue;
    }

    const target = path.resolve(root, file.path);
    if (!target.startsWith(root + path.sep)) {
      continue;
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.content, 'utf8');
  }
}

function runCodexExec({ cwd, prompt, schemaPath, outputPath, model, reasoningEffort, speedTier }) {
  return new Promise((resolve, reject) => {
    const codexCommand = process.env.CODEX_OVERLEAF_CODEX_PATH || 'codex';
    const child = spawn(codexCommand, buildCodexExecArgs({
      cwd,
      schemaPath,
      outputPath,
      model,
      reasoningEffort,
      speedTier
    }), {
      shell: shouldUseShellForCommand(codexCommand),
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stderr = '';
    let stdoutRemainder = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      const parsed = parseCodexJsonLines(`${stdoutRemainder}${chunk}`);
      stdoutRemainder = parsed.remainder;
      for (const event of parsed.events) {
        emitCodexRuntimeEvent(event);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', code => {
      if (stdoutRemainder) {
        const parsed = parseCodexJsonLines(`${stdoutRemainder}\n`);
        stdoutRemainder = '';
        for (const event of parsed.events) {
          emitCodexRuntimeEvent(event);
        }
      }
      emitEvent('codex.exec.completed', 'Codex exec exited', {
        code,
        stderrLength: stderr.length
      }, code === 0 ? 'completed' : 'failed');
      if (code !== 0) {
        reject(new Error(stderr || `codex exec exited with code ${code}`));
        return;
      }

      try {
        resolve(JSON.parse(fs.readFileSync(outputPath, 'utf8')));
      } catch (error) {
        reject(new Error(`Could not parse Codex output: ${error.message}`));
      }
    });

    emitEvent('codex.exec.started', 'Codex exec started', {
      pid: child.pid,
      cwd,
      model,
      reasoningEffort,
      speedTier
    });
    child.stdin.end(prompt);
  });
}

function shouldUseShellForCommand(command) {
  if (process.platform !== 'win32') {
    return false;
  }
  const text = String(command || '');
  return text === 'codex' || /\.(?:cmd|bat)$/i.test(text);
}

function parseCodexJsonLines(text) {
  const lines = text.split(/\r?\n/);
  const remainder = lines.pop() || '';
  const events = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      emitEvent('codex.stdout.line', 'Codex produced non-JSON output', {
        text: truncateInline(trimmed, 500)
      }, 'running');
    }
  }

  return { events, remainder };
}

function emitCodexRuntimeEvent(event) {
  if (event?.type === 'item.completed' || event?.type === 'item.started') {
    emitCodexItemEvent(event);
    return;
  }

  if (event?.type === 'turn.started') {
    emitEvent('codex.turn.started', 'Codex started this turn', {}, 'running');
    return;
  }

  if (event?.type === 'turn.completed') {
    emitEvent('codex.turn.completed', 'Codex completed this turn', {
      usage: event.usage || {}
    }, 'completed');
    return;
  }

  emitEvent(`codex.${event?.type || 'event'}`, event?.type || 'Codex event', {
    event
  }, 'running');
}

function emitCodexItemEvent(event) {
  const item = event.item || {};

  if (item.type === 'agent_message') {
    const text = String(item.text || '').trim();
    if (!text) {
      return;
    }
    if (looksLikeStructuredFinalMessage(text)) {
      emitEvent('codex.agent.result', 'Codex generated structured result', {
        textLength: text.length
      }, 'completed');
      return;
    }
    emitEvent('codex.agent.message', truncateInline(text, 160), {
      text
    }, 'completed');
    return;
  }

  if (item.type === 'command_execution') {
    if (event.type === 'item.started') {
      emitEvent('codex.command.started', `Codex is running: ${truncateInline(item.command, 120)}`, {
        command: item.command || ''
      }, 'running');
      return;
    }

    emitEvent('codex.command.completed', item.exit_code === 0
      ? `Command completed: ${truncateInline(item.command, 120)}`
      : `Command failed: ${truncateInline(item.command, 120)}`, {
      command: item.command || '',
      output: item.aggregated_output || '',
      exitCode: item.exit_code,
      status: item.status || ''
    }, item.exit_code === 0 ? 'completed' : 'failed');
    return;
  }

  emitEvent('codex.item.completed', `Codex item: ${item.type || 'unknown'}`, {
    item
  }, event.type === 'item.completed' ? 'completed' : 'running');
}

function looksLikeStructuredFinalMessage(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && (
      Object.prototype.hasOwnProperty.call(value, 'operations') ||
      Object.prototype.hasOwnProperty.call(value, 'status')
    );
  } catch {
    return false;
  }
}

function truncateInline(text, maxLength) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}
