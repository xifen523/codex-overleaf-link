#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const extensionDir = path.join(repoRoot, 'extension');

const args = parseArgs(process.argv.slice(2));

if (args.help || !args.url) {
  printHelp();
  process.exit(args.help ? 0 : 2);
}

const chromePath = args.chrome || await findChromeExecutable();
if (!chromePath) {
  console.error('Chrome was not found. Pass --chrome /absolute/path/to/Chrome.');
  process.exit(2);
}

if (typeof WebSocket !== 'function') {
  console.error('This smoke test needs a Node runtime with global WebSocket support.');
  process.exit(2);
}

const profileDir = args.profileDir || await fs.mkdtemp(path.join(os.tmpdir(), 'codex-overleaf-chrome-'));
const timeoutMs = Number(args.timeoutMs || 45000);
let chrome = null;

try {
  chrome = spawn(chromePath, [
    `--user-data-dir=${profileDir}`,
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-popup-blocking',
    args.url
  ], {
    stdio: ['ignore', 'ignore', 'pipe']
  });

  chrome.stderr.on('data', chunk => {
    if (args.verbose) {
      process.stderr.write(chunk);
    }
  });

  const port = await waitForDebugPort(profileDir, timeoutMs);
  const target = await waitForTarget(port, args.url, timeoutMs);
  const client = await createCdpClient(target.webSocketDebuggerUrl);
  try {
    await waitForPanel(client, timeoutMs);
  } finally {
    client.close();
  }

  console.log('Codex Overleaf extension smoke test passed: panel was injected into the target page.');
} finally {
  if (chrome && !chrome.killed) {
    chrome.kill('SIGTERM');
  }
  if (!args.keepProfile && !args.profileDir) {
    await fs.rm(profileDir, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--url') parsed.url = argv[++index];
    else if (arg === '--chrome') parsed.chrome = argv[++index];
    else if (arg === '--profile-dir') parsed.profileDir = argv[++index];
    else if (arg === '--timeout-ms') parsed.timeoutMs = argv[++index];
    else if (arg === '--keep-profile') parsed.keepProfile = true;
    else if (arg === '--verbose') parsed.verbose = true;
  }
  return parsed;
}

function printHelp() {
  console.log([
    'Usage:',
    '  npm run smoke:extension -- --url https://www.overleaf.com/project/<project-id>',
    '',
    'Options:',
    '  --chrome <path>       Chrome/Chromium executable path',
    '  --profile-dir <path>  Chrome profile to use for Overleaf login state',
    '  --timeout-ms <ms>     Wait timeout, default 45000',
    '  --keep-profile        Keep the temporary Chrome profile for debugging',
    '  --verbose             Print Chrome stderr'
  ].join('\n'));
}

async function findChromeExecutable() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch (_error) {
      // Try the next known browser path.
    }
  }
  return '';
}

async function waitForDebugPort(profileDir, timeoutMs) {
  const file = path.join(profileDir, 'DevToolsActivePort');
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const content = await fs.readFile(file, 'utf8');
      const [port] = content.trim().split(/\s+/);
      if (port) {
        return port;
      }
    } catch (_error) {
      // Chrome writes DevToolsActivePort after startup.
    }
    await delay(250);
  }
  throw new Error('Timed out waiting for Chrome remote debugging port.');
}

async function waitForTarget(port, expectedUrl, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = await response.json();
    const pageTarget = targets.find(target => target.type === 'page' && target.url?.startsWith(expectedUrl))
      || targets.find(target => target.type === 'page' && /overleaf\.com\/project\//.test(target.url || ''));
    if (pageTarget?.webSocketDebuggerUrl) {
      return pageTarget;
    }
    await delay(500);
  }
  throw new Error('Timed out waiting for the Overleaf project tab.');
}

function createCdpClient(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  let nextId = 0;
  const pending = new Map();

  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) {
      return;
    }
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      reject(new Error(message.error.message || JSON.stringify(message.error)));
    } else {
      resolve(message.result);
    }
  });

  return {
    async send(method, params = {}) {
      await waitForSocketOpen(socket);
      const id = ++nextId;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
    },
    close() {
      socket.close();
    }
  };
}

async function waitForPanel(client, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await client.send('Runtime.evaluate', {
      expression: "Boolean(document.getElementById('codex-overleaf-panel'))",
      returnByValue: true
    });
    if (result?.result?.value === true) {
      return;
    }
    await delay(500);
  }
  throw new Error('Timed out waiting for #codex-overleaf-panel. Check that the URL is an Overleaf project page and the profile is logged in.');
}

function waitForSocketOpen(socket) {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
