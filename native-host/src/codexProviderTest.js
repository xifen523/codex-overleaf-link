'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveCodexCommand, shouldUseShellForCommand } = require('./codexCommand');
const { applyProviderEnvironment, buildProviderConfigArgs, prepareProviderLaunch } = require('./codexProviderLaunch');
const { providerError } = require('./providerProfile');

const MAX_OUTPUT_BYTES = 256 * 1024;

async function runProviderConnectionTest({ launch, env = process.env, signal } = {}) {
  const prepared = await prepareProviderLaunch(launch, { signal });
  try {
    return await runProviderConnectionTestProcess({ launch: prepared.launch, env, signal });
  } finally {
    await prepared.close();
  }
}

function runProviderConnectionTestProcess({ launch, env = process.env, signal } = {}) {
  return new Promise((resolve, reject) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-provider-test-'));
    const codexHome = path.join(root, 'codex-home');
    const workspace = path.join(root, 'workspace');
    fs.mkdirSync(codexHome, { recursive: true, mode: 0o700 });
    fs.mkdirSync(workspace, { recursive: true, mode: 0o700 });
    const childEnv = applyProviderEnvironment({
      ...env,
      CODEX_HOME: codexHome
    }, launch);
    const command = resolveCodexCommand(childEnv);
    if (!command) {
      cleanup(root);
      reject(providerError('codex_not_found', 'Codex CLI was not found locally.'));
      return;
    }
    const args = [
      ...buildProviderConfigArgs(launch),
      'exec',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      'Reply only with OK.'
    ];
    const startedAt = Date.now();
    let child;
    try {
      child = spawn(command, args, {
        cwd: workspace,
        env: childEnv,
        shell: shouldUseShellForCommand(command, childEnv),
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      cleanup(root);
      reject(providerError('provider_test_spawn_failed', 'Codex could not start the provider connection test.', { cause: error }));
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeoutMs = Math.min(120000, Math.max(5000, Number(launch.requestTimeoutMs) || 30000));
    const timer = setTimeout(() => finish(providerError('provider_connection_timeout', 'The provider connection test timed out.')), timeoutMs);
    const onAbort = () => finish(providerError('provider_test_cancelled', 'Provider connection test was cancelled.'));
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => appendOutput('stdout', chunk));
    child.stderr.on('data', chunk => appendOutput('stderr', chunk));
    child.on('error', error => finish(providerError('provider_test_spawn_failed', 'Codex could not start the provider connection test.', { cause: error })));
    child.on('close', code => {
      if (code === 0) {
        finish(null, { durationMs: Date.now() - startedAt });
        return;
      }
      finish(classifyProviderFailure(stderr || stdout, code));
    });

    function appendOutput(target, chunk) {
      if (settled) return;
      if (target === 'stdout') stdout += chunk;
      else stderr += chunk;
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > MAX_OUTPUT_BYTES) {
        finish(providerError('provider_response_invalid', 'Provider connection test exceeded the output limit.'));
      }
    }

    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error) terminateProcessTree(child);
      cleanup(root);
      if (error) reject(error);
      else resolve(result);
    }
  });
}

function classifyProviderFailure(text, exitCode) {
  const message = String(text || '');
  if (/\b401\b|unauthori[sz]ed|invalid api key|incorrect api key|authentication/i.test(message)) {
    return providerError('provider_auth_rejected', 'The provider rejected the API key.');
  }
  if (/\b403\b|forbidden/i.test(message)) {
    return providerError('provider_auth_rejected', 'The provider denied access for this credential.');
  }
  if (/\b429\b|rate.?limit|too many requests/i.test(message)) {
    return providerError('provider_rate_limited', 'The provider rate limit was reached.');
  }
  if (/model.{0,40}(not found|does not exist|unknown)|\b404\b.{0,80}model/i.test(message)) {
    return providerError('provider_model_not_found', 'The configured model was not found.');
  }
  if (/certificate|self.signed|tls|ssl/i.test(message)) {
    return providerError('provider_tls_failed', 'TLS verification failed for the provider endpoint.');
  }
  if (/enotfound|eai_again|name or service not known|dns/i.test(message)) {
    return providerError('provider_dns_failed', 'The provider hostname could not be resolved.');
  }
  if (/\b404\b|\b405\b|unsupported.{0,30}(endpoint|api|protocol)|responses.{0,30}(unsupported|not found)|chat\/completions.{0,30}(unsupported|not found)/i.test(message)) {
    return providerError('provider_protocol_incompatible', 'The endpoint is incompatible with this API protocol.');
  }
  if (/timed?\s*out|timeout/i.test(message)) {
    return providerError('provider_connection_timeout', 'The provider connection timed out.');
  }
  return providerError('provider_response_invalid', `Provider connection test failed with exit code ${exitCode}.`);
}

function terminateProcessTree(child) {
  if (!child?.pid) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(-child.pid, 'SIGTERM');
      setTimeout(() => {
        try { process.kill(-child.pid, 'SIGKILL'); } catch (_error) {}
      }, 500).unref?.();
    }
  } catch (_error) {
    try { child.kill('SIGKILL'); } catch (_killError) {}
  }
}

function cleanup(root) {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch (_error) {}
}

module.exports = {
  classifyProviderFailure,
  runProviderConnectionTest
};
