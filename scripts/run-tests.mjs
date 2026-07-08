#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), '..');
const testDir = path.join(rootDir, 'test');
const TEST_FILE_TIMEOUT_MS = Number.parseInt(process.env.CODEX_OVERLEAF_TEST_FILE_TIMEOUT_MS || '600000', 10);
const testFiles = fs.readdirSync(testDir)
  .filter((fileName) => fileName.endsWith('.test.js'))
  .sort()
  .map((fileName) => path.join('test', fileName));

for (const testFile of testFiles) {
  const startedAt = Date.now();
  console.error(`[run-tests] starting ${testFile}`);
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-force-exit', testFile], {
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
