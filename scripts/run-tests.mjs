#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), '..');
const testDir = path.join(rootDir, 'test');
const TEST_FILE_TIMEOUT_MS = Number.parseInt(process.env.CODEX_OVERLEAF_TEST_FILE_TIMEOUT_MS || '600000', 10);
const USE_TEST_ISOLATION_NONE = supportsNodeOption('--test-isolation=none');
const testFiles = fs.readdirSync(testDir)
  .filter((fileName) => fileName.endsWith('.test.js'))
  .sort()
  .map((fileName) => path.join('test', fileName));

for (const testFile of testFiles) {
  const startedAt = Date.now();
  console.error(`[run-tests] starting ${testFile}`);
  const result = spawnSync(process.execPath, getNodeTestArgs(testFile), {
    cwd: rootDir,
    stdio: 'inherit',
    timeout: TEST_FILE_TIMEOUT_MS
  });

  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      console.error(`Test file timed out after ${TEST_FILE_TIMEOUT_MS}ms: ${testFile}`);
      process.exit(1);
    }
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  console.error(`[run-tests] passed ${testFile} in ${Date.now() - startedAt}ms`);
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
