#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), '..');
const testDir = path.join(rootDir, 'test');
const TEST_FILE_TIMEOUT_MS = Number.parseInt(process.env.CODEX_OVERLEAF_TEST_FILE_TIMEOUT_MS || '600000', 10);
const RELEASE_SCRIPTS_TEST_TIMEOUT_MS = Number.parseInt(
  process.env.CODEX_OVERLEAF_RELEASE_SCRIPTS_TEST_TIMEOUT_MS || '120000',
  10
);
const HIGH_PRIORITY_TEST_FILE_NAMES = new Set([
  'releaseScripts.test.js'
]);
const USE_TEST_ISOLATION_NONE = supportsNodeOption('--test-isolation=none');
const testFiles = fs.readdirSync(testDir)
  .filter((fileName) => fileName.endsWith('.test.js'))
  .sort()
  .map((fileName) => path.join('test', fileName))
  .sort((left, right) => getTestFilePriority(left) - getTestFilePriority(right) || left.localeCompare(right));

for (const testFile of testFiles) {
  const startedAt = Date.now();
  const nodeArgs = getNodeTestArgs(testFile);
  const timeoutMs = getTestFileTimeoutMs(testFile);
  console.error(`[run-tests] starting ${testFile} (${nodeArgs.join(' ')}, timeout=${timeoutMs}ms)`);
  const result = spawnSync(process.execPath, nodeArgs, {
    cwd: rootDir,
    stdio: 'inherit',
    timeout: timeoutMs
  });

  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      console.error(`Test file timed out after ${timeoutMs}ms: ${testFile}`);
      process.exit(1);
    }
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  console.error(`[run-tests] passed ${testFile} in ${Date.now() - startedAt}ms`);
}

function getTestFilePriority(testFile) {
  return HIGH_PRIORITY_TEST_FILE_NAMES.has(path.basename(testFile)) ? 0 : 1;
}

function getTestFileTimeoutMs(testFile) {
  if (path.basename(testFile) === 'releaseScripts.test.js') {
    return RELEASE_SCRIPTS_TEST_TIMEOUT_MS;
  }
  return TEST_FILE_TIMEOUT_MS;
}

function getNodeTestArgs(testFile) {
  const args = ['--test', '--test-concurrency=1'];
  if (USE_TEST_ISOLATION_NONE) {
    // run-tests.mjs already gives every test file its own subprocess. Keeping
    // Node's inner per-file isolation process adds a second lifecycle boundary;
    // on hosted macOS it can keep the file wrapper alive after releaseScripts
    // finishes, which makes CI look hung until the outer timeout kills it.
    args.push('--test-isolation=none');
  }
  args.push(testFile);
  return args;
}

function supportsNodeOption(option) {
  const result = spawnSync(process.execPath, [option, '--version'], {
    encoding: 'utf8',
    stdio: 'ignore'
  });
  return result.status === 0;
}
