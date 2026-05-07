#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ARCHITECTURE_FILE_BUDGETS = Object.freeze([
  {
    path: 'extension/src/contentScript.js',
    maxLines: 4500,
    currentCeiling: 9498,
    exception: 'v0.9.5 extracts attachments, diff review, and context tray; remaining UI/state controllers must be split before v1.0.'
  },
  {
    path: 'extension/src/pageBridge.js',
    maxLines: 2200,
    currentCeiling: 4654,
    exception: 'v0.9.5 extracts the capability guard; snapshot, tree, and writeback routing remain follow-up page modules.'
  },
  {
    path: 'native-host/src/codexSessionRunner.js',
    maxLines: 1500,
    currentCeiling: 2198,
    exception: 'v0.9.5 extracts response budgeting; session orchestration and skill prompt assembly remain follow-up modules.'
  },
  {
    path: 'native-host/src/taskRunner.js',
    maxLines: 1000,
    currentCeiling: 1083,
    exception: 'v0.9.5 extracts native quotas; command approval still needs a focused follow-up split.'
  }
]);

export function collectArchitectureBudgetResults(options = {}) {
  const rootDir = path.resolve(options.rootDir || getRepoRoot());
  const enforceTarget = options.enforceTarget === true;
  return ARCHITECTURE_FILE_BUDGETS.map(budget => {
    const fullPath = path.join(rootDir, budget.path);
    const lineCount = fs.existsSync(fullPath) ? countLines(fs.readFileSync(fullPath, 'utf8')) : 0;
    const ceiling = enforceTarget ? budget.maxLines : budget.currentCeiling;
    return {
      path: budget.path,
      lineCount,
      maxLines: budget.maxLines,
      currentCeiling: budget.currentCeiling,
      exception: budget.exception || '',
      ceiling,
      ok: lineCount > 0 && lineCount <= ceiling,
      targetMet: lineCount > 0 && lineCount <= budget.maxLines
    };
  });
}

export function collectArchitectureBudgetErrors(options = {}) {
  const results = collectArchitectureBudgetResults(options);
  return results
    .filter(result => !result.ok)
    .map(result => {
      if (result.lineCount <= 0) {
        return `${result.path} must exist for architecture budget checks.`;
      }
      return `${result.path} has ${result.lineCount} lines; limit is ${result.ceiling}.`;
    });
}

function countLines(text) {
  if (!text) {
    return 0;
  }
  return text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
}

function getRepoRoot() {
  const __filename = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(__filename), '..');
}

function runCli() {
  const enforceTarget = process.argv.includes('--enforce-target');
  const results = collectArchitectureBudgetResults({ enforceTarget });
  for (const result of results) {
    const status = result.ok ? 'ok' : 'fail';
    const target = result.targetMet ? 'target' : 'exception';
    const exception = result.exception ? `\t${result.exception}` : '';
    console.log(`${status}\t${target}\t${result.lineCount}/${result.ceiling}\t${result.path}${exception}`);
  }
  const errors = collectArchitectureBudgetErrors({ enforceTarget });
  if (errors.length) {
    for (const error of errors) {
      console.error(error);
    }
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli();
}
