#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const extensionDir = path.join(repoRoot, 'extension');
const DEFAULT_TIMEOUT_MS = 45000;
const DEFAULT_POLL_INTERVAL_MS = 500;
const SUPPORTED_PROBES = Object.freeze(['panel', 'native', 'project', 'diagnostics']);
const SMOKE_RESULT_FIELDS = Object.freeze([
  'timestamp',
  'urlOrigin',
  'projectIdHash',
  'extensionVersion',
  'chromeVersion',
  'nativeCompatibility',
  'probes',
  'metrics',
  'errors'
]);
const NUMERIC_METRIC_KEYS = Object.freeze([
  'durationMs',
  'fileCount',
  'textBytes',
  'binaryBytes',
  'skippedCount'
]);
const NATIVE_CAPABILITY_NAMES = new Set([
  'bridgePing',
  'mirrorSync',
  'mirrorPatchFiles',
  'mirrorStatus',
  'codexRun',
  'codexCancel',
  'codexModels',
  'historyClearPlugin',
  'localSkills',
  'mirrorSensitiveScan'
]);
const PROBE_TEXT_FIELDS = Object.freeze([
  'status',
  'errorCode',
  'errorCategory',
  'reason'
]);

if (isDirectRun()) {
  main().then(exitCode => {
    process.exit(exitCode);
  }).catch(error => {
    console.error(sanitizeText(error?.message || String(error)));
    process.exit(1);
  });
}

async function main(argv = process.argv.slice(2)) {
  let args;
  let probes;
  try {
    args = parseArgs(argv);
    probes = normalizeProbes(args.probe);
  } catch (error) {
    console.error(sanitizeText(error?.message || String(error)));
    printHelp();
    return 2;
  }

  if (args.help || !args.url) {
    printHelp();
    return args.help ? 0 : 2;
  }

  const chromePath = args.chrome || await findChromeExecutable();
  if (!chromePath) {
    console.error('Chrome was not found. Pass --chrome /absolute/path/to/Chrome.');
    return 2;
  }

  if (typeof WebSocket !== 'function') {
    console.error('This smoke test needs a Node runtime with global WebSocket support.');
    return 2;
  }

  const profileDir = args.profileDir || await fs.mkdtemp(path.join(os.tmpdir(), 'codex-overleaf-chrome-'));
  const timeoutMs = Number(args.timeoutMs || DEFAULT_TIMEOUT_MS);
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
      const result = await collectSmokeResult(client, {
        url: args.url,
        probes,
        timeoutMs
      });
      if (args.jsonPath) {
        await writeSmokeJson(args.jsonPath, result);
      }
      reportSmokeResult(result, probes);
      return hasFailedProbe(result, probes) ? 1 : 0;
    } finally {
      client.close();
    }
  } finally {
    if (chrome && !chrome.killed) {
      chrome.kill('SIGTERM');
    }
    if (!args.keepProfile && !args.profileDir) {
      await fs.rm(profileDir, { recursive: true, force: true });
    }
  }
}

export function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--url') parsed.url = readOptionValue(argv, ++index, arg);
    else if (arg === '--chrome') parsed.chrome = readOptionValue(argv, ++index, arg);
    else if (arg === '--json') parsed.jsonPath = readOptionValue(argv, ++index, arg);
    else if (arg === '--probe') parsed.probe = appendProbeValue(parsed.probe, readOptionValue(argv, ++index, arg));
    else if (arg === '--profile-dir') parsed.profileDir = readOptionValue(argv, ++index, arg);
    else if (arg === '--timeout-ms') parsed.timeoutMs = readOptionValue(argv, ++index, arg);
    else if (arg === '--keep-profile') parsed.keepProfile = true;
    else if (arg === '--verbose') parsed.verbose = true;
    else if (arg.startsWith('-')) throw new Error(`Unknown smoke-test option: ${arg}`);
  }
  return parsed;
}

export function normalizeProbes(value) {
  const rawValues = Array.isArray(value) ? value : [value || 'panel'];
  const requested = rawValues
    .flatMap(item => String(item || '').split(','))
    .map(item => item.trim())
    .filter(Boolean);
  const names = requested.length ? requested : ['panel'];
  for (const name of names) {
    if (name !== 'all' && !SUPPORTED_PROBES.includes(name)) {
      throw new Error(`Unsupported smoke probe "${name}". Use one of: ${SUPPORTED_PROBES.join(', ')}, all.`);
    }
  }
  if (names.includes('all')) {
    return [...SUPPORTED_PROBES];
  }
  const normalized = [];
  for (const name of names) {
    if (!normalized.includes(name)) {
      normalized.push(name);
    }
  }
  return normalized;
}

export function redactSmokeResult(result) {
  const redacted = {};
  for (const field of SMOKE_RESULT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(result || {}, field)) {
      continue;
    }
    if (field === 'nativeCompatibility') {
      redacted[field] = sanitizeNativeCompatibility(result[field]);
    } else if (field === 'probes') {
      redacted[field] = sanitizeProbes(result[field]);
    } else if (field === 'metrics') {
      redacted[field] = sanitizeMetrics(result[field]);
    } else if (field === 'errors') {
      redacted[field] = sanitizeErrors(result[field]);
    } else {
      redacted[field] = sanitizeValue(result[field]);
    }
  }
  return redacted;
}

export async function runProbe(client, probe, context = {}) {
  const timeoutMs = Number(context.timeoutMs || DEFAULT_TIMEOUT_MS);
  const pollIntervalMs = Number(context.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS);
  const startedAt = Date.now();
  try {
    if (probe === 'panel') {
      await waitForRuntimeValue(
        client,
        "Boolean(document.getElementById('codex-overleaf-panel'))",
        value => value === true,
        { timeoutMs, pollIntervalMs }
      );
      return probeResult('panel', 'passed', startedAt);
    }
    if (probe === 'native') {
      const value = await evaluateSmokeHelperRuntimeValue(client, nativeProbeExpression(), {
        timeoutMs,
        pollIntervalMs
      });
      return normalizeNativeProbeResult(value, startedAt);
    }
    if (probe === 'project') {
      const value = await evaluateSmokeHelperRuntimeValue(client, projectProbeExpression(), {
        timeoutMs,
        pollIntervalMs
      });
      return normalizeProjectProbeResult(value, startedAt);
    }
    if (probe === 'diagnostics') {
      const value = await evaluateRuntimeValue(client, diagnosticsProbeExpression());
      return normalizeDiagnosticsProbeResult(value, startedAt);
    }
    return unsupportedProbeResult(probe, 'unsupported smoke probe', startedAt);
  } catch (error) {
    return {
      probe,
      status: 'failed',
      errorCode: 'probe_failed',
      message: sanitizeText(error?.message || String(error)),
      metrics: {
        durationMs: Date.now() - startedAt
      }
    };
  }
}

function printHelp() {
  console.log([
    'Usage:',
    '  npm run smoke:extension -- --url https://www.overleaf.com/project/<project-id>',
    '',
    'Options:',
    '  --chrome <path>       Chrome/Chromium executable path',
    '  --json <path>         Write redacted smoke result JSON',
    '  --probe <name>        panel, native, project, diagnostics, or all; default panel',
    '  --profile-dir <path>  Chrome profile to use for Overleaf login state',
    `  --timeout-ms <ms>     Wait timeout, default ${DEFAULT_TIMEOUT_MS}`,
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

async function collectSmokeResult(client, options) {
  const result = {
    timestamp: new Date().toISOString(),
    urlOrigin: getUrlOrigin(options.url),
    projectIdHash: hashProjectIdFromUrl(options.url),
    extensionVersion: await readExtensionVersion(),
    chromeVersion: await readChromeVersion(client),
    nativeCompatibility: null,
    probes: {},
    metrics: {},
    errors: []
  };
  for (const probe of options.probes) {
    const probeResultValue = await runProbe(client, probe, { timeoutMs: options.timeoutMs });
    result.probes[probe] = sanitizeProbeForResult(probeResultValue);
    if (probeResultValue.metrics) {
      result.metrics[probe] = sanitizeValue(probeResultValue.metrics);
    }
    if (probeResultValue.nativeCompatibility) {
      result.nativeCompatibility = sanitizeNativeCompatibility(probeResultValue.nativeCompatibility);
    }
    if (probeResultValue.status !== 'passed') {
      result.errors.push({
        probe,
        errorCode: probeResultValue.errorCode || probeResultValue.status,
        message: probeResultValue.message || probeResultValue.reason || `${probe} probe ${probeResultValue.status}`
      });
    }
  }
  return redactSmokeResult(result);
}

function createCdpClient(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  let nextId = 0;
  const pending = new Map();
  const eventListeners = new Map();

  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) {
      if (message.method && eventListeners.has(message.method)) {
        for (const listener of eventListeners.get(message.method)) {
          listener(message.params || {});
        }
      }
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
    on(method, listener) {
      const listeners = eventListeners.get(method) || new Set();
      listeners.add(listener);
      eventListeners.set(method, listeners);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          eventListeners.delete(method);
        }
      };
    },
    close() {
      socket.close();
    }
  };
}

async function waitForRuntimeValue(client, expression, predicate, options = {}) {
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const pollIntervalMs = Number(options.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await evaluateRuntimeValue(client, expression);
    if (predicate(value)) {
      return value;
    }
    await delay(pollIntervalMs);
  }
  throw new Error('Timed out waiting for #codex-overleaf-panel. Check that the URL is an Overleaf project page and the profile is logged in.');
}

async function evaluateRuntimeValue(client, expression, options = {}) {
  const params = {
    expression,
    awaitPromise: true,
    returnByValue: true
  };
  if (Number.isInteger(options.contextId)) {
    params.contextId = options.contextId;
  }
  const response = await client.send('Runtime.evaluate', {
    ...params
  });
  if (response?.exceptionDetails) {
    throw new Error(response.exceptionDetails.text || 'Runtime.evaluate failed.');
  }
  return response?.result?.value;
}

async function evaluateSmokeHelperRuntimeValue(client, expression, options = {}) {
  const contextId = await waitForSmokeHelperContextId(client, options);
  return evaluateRuntimeValue(client, expression, Number.isInteger(contextId) ? { contextId } : {});
}

async function waitForSmokeHelperContextId(client, options = {}) {
  if (typeof client.on !== 'function') {
    return null;
  }

  const contexts = new Map();
  const removeListener = client.on('Runtime.executionContextCreated', event => {
    const context = event?.context;
    if (Number.isInteger(context?.id)) {
      contexts.set(context.id, context);
    }
  });

  try {
    await client.send('Runtime.enable');
    const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
    const pollIntervalMs = Number(options.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS);
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      for (const context of contexts.values()) {
        if (await contextHasSmokeHelper(client, context.id)) {
          return context.id;
        }
      }
      await delay(pollIntervalMs);
    }
    return null;
  } catch (_error) {
    return null;
  } finally {
    removeListener?.();
  }
}

async function contextHasSmokeHelper(client, contextId) {
  try {
    return await evaluateRuntimeValue(client, smokeHelperAvailableExpression(), { contextId }) === true;
  } catch (_error) {
    return false;
  }
}

function smokeHelperAvailableExpression() {
  return `(${function smokeHelperAvailable() {
    const smoke = globalThis.CodexOverleafSmoke
      || globalThis.codexOverleafSmoke
      || globalThis.__codexOverleafSmoke;
    return Boolean(
      smoke
      && typeof smoke.probeNative === 'function'
      && typeof smoke.probeProject === 'function'
    );
  }})()`;
}

function nativeProbeExpression() {
  return smokeHelperProbeExpression('probeNative', {});
}

function projectProbeExpression() {
  return smokeHelperProbeExpression('probeProject', {
    includeContent: false,
    includeText: false,
    includeBinaryData: false
  });
}

function smokeHelperProbeExpression(method, args) {
  return `(${async function smokeHelperProbe(helperMethod, helperArgs) {
    const smoke = globalThis.CodexOverleafSmoke
      || globalThis.codexOverleafSmoke
      || globalThis.__codexOverleafSmoke;
    if (!smoke || typeof smoke[helperMethod] !== 'function') {
      return { supported: false, reason: 'content_smoke_helper_unavailable' };
    }
    try {
      return await smoke[helperMethod](helperArgs || {});
    } catch (error) {
      return {
        supported: true,
        ok: false,
        errorCode: `${String(helperMethod || 'smoke').replace(/^probe/, '').toLowerCase() || 'smoke'}_probe_failed`,
        message: 'content smoke helper failed'
      };
    }
  }})(${JSON.stringify(method)}, ${JSON.stringify(args)})`;
}

function diagnosticsProbeExpression() {
  return `(${function smokeDiagnosticsProbe() {
    const panel = document.getElementById('codex-overleaf-panel');
    if (!panel) {
      return { supported: false, reason: 'panel_unavailable' };
    }
    const diagnosticsMenu = Boolean(panel.querySelector('[data-diagnostics-menu]'));
    const exportButton = Boolean(panel.querySelector('[data-diagnostics-export]'));
    const resultSurface = Boolean(panel.querySelector('[data-diagnostics-result]'));
    return {
      supported: diagnosticsMenu && exportButton,
      diagnosticsMenu,
      exportButton,
      resultSurface,
      reason: diagnosticsMenu && exportButton ? '' : 'diagnostics_export_surface_unavailable'
    };
  }})()`;
}

function normalizeNativeProbeResult(value, startedAt) {
  if (!value || value.supported === false) {
    return unsupportedProbeResult('native', value?.reason || 'native bridge probe unavailable', startedAt);
  }
  const nativeCompatibility = sanitizeNativeCompatibility(value.nativeCompatibility || value.compatibility || value);
  const compatibilityStatus = nativeCompatibility?.status || '';
  const ok = value.ok === true || value.status === 'ok' || compatibilityStatus === 'ok';
  return {
    probe: 'native',
    status: ok ? 'passed' : 'failed',
    errorCode: ok ? undefined : value.errorCode || compatibilityStatus || 'native_unavailable',
    message: ok ? undefined : sanitizeText(value.message || compatibilityStatus || 'native probe failed'),
    nativeCompatibility,
    metrics: {
      durationMs: Date.now() - startedAt
    }
  };
}

function normalizeProjectProbeResult(value, startedAt) {
  if (!value || value.supported === false) {
    return unsupportedProbeResult('project', value?.reason || 'project snapshot probe unavailable', startedAt);
  }
  if (value.ok === false) {
    return {
      probe: 'project',
      status: 'failed',
      errorCode: value.errorCode || 'project_probe_failed',
      message: 'project snapshot probe failed',
      metrics: {
        durationMs: Date.now() - startedAt
      }
    };
  }
  const metrics = compactMetrics({
    fileCount: value.fileCount ?? value.counts?.fileCount ?? value.counts?.files,
    textBytes: value.textBytes ?? value.bytes?.textBytes ?? value.bytes?.text,
    binaryBytes: value.binaryBytes ?? value.bytes?.binaryBytes ?? value.bytes?.binary,
    skippedCount: value.skippedCount ?? value.counts?.skippedCount ?? value.counts?.skipped
  });
  return {
    probe: 'project',
    status: 'passed',
    metrics: {
      durationMs: Date.now() - startedAt,
      ...metrics
    }
  };
}

function normalizeDiagnosticsProbeResult(value, startedAt) {
  if (!value || value.supported === false) {
    return unsupportedProbeResult('diagnostics', value?.reason || 'diagnostics probe unavailable', startedAt);
  }
  return {
    probe: 'diagnostics',
    status: 'passed',
    metrics: {
      durationMs: Date.now() - startedAt,
      diagnosticsMenu: value.diagnosticsMenu === true,
      exportButton: value.exportButton === true,
      resultSurface: value.resultSurface === true
    }
  };
}

function probeResult(probe, status, startedAt) {
  return {
    probe,
    status,
    metrics: {
      durationMs: Date.now() - startedAt
    }
  };
}

function unsupportedProbeResult(probe, reason, startedAt) {
  return {
    probe,
    status: 'unsupported',
    errorCode: 'unsupported_probe',
    reason: sanitizeText(reason || 'probe unavailable'),
    metrics: {
      durationMs: Date.now() - startedAt
    }
  };
}

function sanitizeProbeForResult(result) {
  const { durationMs, ...metrics } = result.metrics || {};
  return sanitizeProbeRecord({
    ...result,
    ...metrics,
    timing: {
      durationMs
    }
  });
}

function compactMetrics(metrics) {
  const compact = {};
  for (const [key, value] of Object.entries(metrics)) {
    const number = Number(value);
    if (Number.isFinite(number)) {
      compact[key] = number;
    }
  }
  return compact;
}

async function readExtensionVersion() {
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(extensionDir, 'manifest.json'), 'utf8'));
    return manifest.version || '';
  } catch (_error) {
    return '';
  }
}

async function readChromeVersion(client) {
  try {
    const version = await client.send('Browser.getVersion');
    return version?.product || version?.userAgent || '';
  } catch (_error) {
    return '';
  }
}

async function writeSmokeJson(file, result) {
  const redacted = redactSmokeResult(result);
  await fs.mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(redacted, null, 2)}\n`);
}

function reportSmokeResult(result, requestedProbes) {
  const failed = hasFailedProbe(result, requestedProbes);
  if (!failed && requestedProbes.length === 1 && requestedProbes[0] === 'panel') {
    console.log('Codex Overleaf extension smoke test passed: panel was injected into the target page.');
    return;
  }
  const summary = requestedProbes
    .map(probe => `${probe}=${result.probes?.[probe]?.status || 'missing'}`)
    .join(', ');
  if (failed) {
    console.error(`Codex Overleaf extension smoke test failed: ${summary}.`);
  } else {
    console.log(`Codex Overleaf extension smoke test passed: ${summary}.`);
  }
}

function hasFailedProbe(result, requestedProbes) {
  return requestedProbes.some(probe => result.probes?.[probe]?.status !== 'passed');
}

function sanitizeNativeCompatibility(value) {
  if (!value || typeof value !== 'object') {
    return value == null ? value : sanitizeReason(value);
  }
  const safe = {};
  for (const key of [
    'status',
    'nativeVersion',
    'version',
    'minNativeVersion',
    'minimumNativeVersion',
    'protocolVersion',
    'supportedProtocol',
    'extensionVersion',
    'requiredExtensionVersion'
  ]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      safe[key] = sanitizeReason(value[key]);
    }
  }
  if (value.native && typeof value.native === 'object') {
    if (!safe.nativeVersion && value.native.version) {
      safe.nativeVersion = sanitizeReason(value.native.version);
    }
    if (!safe.protocolVersion && value.native.protocolVersion) {
      safe.protocolVersion = sanitizeReason(value.native.protocolVersion);
    }
    if (!safe.supportedProtocol && value.native.supportedProtocol) {
      safe.supportedProtocol = sanitizeReason(value.native.supportedProtocol);
    }
  }
  const capabilities = sanitizeCapabilitySummary(value.capabilities || value.capabilitySummary || value.native?.capabilities);
  if (capabilities && Object.keys(capabilities).length) {
    safe.capabilities = capabilities;
  }
  return safe;
}

function sanitizeProbes(probes) {
  if (!probes || typeof probes !== 'object') {
    return {};
  }
  const safe = {};
  for (const probe of SUPPORTED_PROBES) {
    if (Object.prototype.hasOwnProperty.call(probes, probe)) {
      safe[probe] = sanitizeProbeRecord({
        probe,
        ...probes[probe]
      });
    }
  }
  return safe;
}

function sanitizeProbeRecord(record = {}) {
  const safe = {};
  if (SUPPORTED_PROBES.includes(record.probe)) {
    safe.probe = record.probe;
  }
  for (const key of PROBE_TEXT_FIELDS) {
    if (record[key] !== undefined) {
      safe[key] = sanitizeReason(record[key]);
    }
  }
  if (typeof record.ok === 'boolean') {
    safe.ok = record.ok;
  }
  if (typeof record.supported === 'boolean') {
    safe.supported = record.supported;
  }
  const flatMetrics = sanitizeFlatMetrics(record);
  Object.assign(safe, flatMetrics);
  const counts = sanitizeMetricGroup(record.counts, ['files', 'fileCount', 'skipped', 'skippedCount']);
  if (counts && Object.keys(counts).length) {
    safe.counts = counts;
  }
  const bytes = sanitizeMetricGroup(record.bytes, ['text', 'textBytes', 'binary', 'binaryBytes']);
  if (bytes && Object.keys(bytes).length) {
    safe.bytes = bytes;
  }
  const timing = sanitizeMetricGroup(record.timing, ['durationMs']);
  if (timing && Object.keys(timing).length) {
    safe.timing = timing;
  }
  return safe;
}

function sanitizeMetrics(metrics) {
  if (!metrics || typeof metrics !== 'object') {
    return {};
  }
  const safe = {};
  for (const probe of SUPPORTED_PROBES) {
    const value = metrics[probe];
    const sanitized = sanitizeFlatMetrics(value);
    if (Object.keys(sanitized).length) {
      safe[probe] = sanitized;
    }
  }
  return safe;
}

function sanitizeFlatMetrics(value = {}) {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const safe = {};
  for (const key of NUMERIC_METRIC_KEYS) {
    const number = Number(value[key]);
    if (Number.isFinite(number)) {
      safe[key] = number;
    }
  }
  return safe;
}

function sanitizeMetricGroup(value, allowedKeys) {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const safe = {};
  for (const key of allowedKeys) {
    const number = Number(value[key]);
    if (Number.isFinite(number)) {
      safe[key] = number;
    }
  }
  return safe;
}

function sanitizeCapabilitySummary(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const safe = {};
  for (const key of NATIVE_CAPABILITY_NAMES) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      continue;
    }
    const child = value[key];
    if (typeof child === 'boolean') {
      safe[key] = child;
    }
  }
  return safe;
}

function sanitizeErrors(errors) {
  return Array.isArray(errors)
    ? errors.map(error => {
      const errorCategory = sanitizeReason(
        error?.errorCategory || error?.errorCode || error?.code || error?.status || 'probe_failed'
      ) || 'probe_failed';
      const safe = {
        errorCategory,
        message: formatRedactedErrorMessage(error?.probe, errorCategory)
      };
      if (SUPPORTED_PROBES.includes(error?.probe)) {
        safe.probe = error.probe;
      }
      if (error?.errorCode) {
        safe.errorCode = sanitizeReason(error.errorCode);
      }
      return safe;
    })
    : [];
}

function formatRedactedErrorMessage(probe, errorCategory) {
  const safeProbe = SUPPORTED_PROBES.includes(probe) ? probe : 'smoke';
  const safeCategory = sanitizeReason(errorCategory) || 'probe_failed';
  return `${safeProbe} probe failed: ${safeCategory}`;
}

function sanitizeValue(value) {
  if (typeof value === 'string') {
    return sanitizeText(value);
  }
  if (Array.isArray(value)) {
    return value.map(item => sanitizeValue(item)).filter(item => item !== undefined);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (shouldDropField(key)) {
      continue;
    }
    const sanitized = sanitizeValue(child);
    if (sanitized !== undefined) {
      output[key] = sanitized;
    }
  }
  return output;
}

function sanitizeText(value) {
  return String(value || '')
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[redacted]')
    .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{10,}\b/g, '[redacted]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, '[redacted]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[redacted]')
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '[redacted]')
    .replace(/\b(?=[A-Za-z0-9+/]{32,}={0,2}\b)(?=[A-Za-z0-9+/]*[+/=])[A-Za-z0-9+/]{32,}={0,2}\b/g, '[redacted]');
}

function sanitizeReason(value) {
  const sanitized = sanitizeText(value);
  if (!sanitized) {
    return '';
  }
  if (sanitized.includes('[redacted]')) {
    return '[redacted]';
  }
  if (sanitized.length > 160 || /private|secret|theorem|excerpt|preview|summary|prompt|token|password|api\s*key/i.test(sanitized)) {
    return '[redacted]';
  }
  return sanitized;
}

function shouldDropField(key) {
  const normalized = String(key || '').replace(/[_-]/g, '').toLowerCase();
  return [
    'content',
    'contents',
    'text',
    'projecttext',
    'prompt',
    'prompttext',
    'compilelog',
    'log',
    'logs',
    'diff',
    'patch',
    'binarybase64',
    'base64',
    'dataurl',
    'blob',
    'file',
    'files',
    'path',
    'paths',
    'activepath',
    'url',
    'projectid',
    'secret',
    'token',
    'accesstoken',
    'refreshtoken',
    'password',
    'apikey',
    'privatekey'
  ].includes(normalized);
}

function getUrlOrigin(rawUrl) {
  try {
    return new URL(rawUrl).origin;
  } catch (_error) {
    return '';
  }
}

function hashProjectIdFromUrl(rawUrl) {
  const projectId = getProjectIdFromUrl(rawUrl);
  if (!projectId) {
    return '';
  }
  return `sha256:${createHash('sha256').update(projectId).digest('hex')}`;
}

function getProjectIdFromUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const match = url.pathname.match(/\/project\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  } catch (_error) {
    return '';
  }
}

function appendProbeValue(existing, value) {
  if (!existing) {
    return value;
  }
  return Array.isArray(existing) ? [...existing, value] : [existing, value];
}

function readOptionValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${option}.`);
  }
  return value;
}

function isDirectRun() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
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
