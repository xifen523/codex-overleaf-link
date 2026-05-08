#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ARCHITECTURE_FILE_BUDGETS = Object.freeze([
  {
    path: 'extension/src/contentScript.js',
    maxLines: 4500
  },
  {
    path: 'extension/src/pageBridge.js',
    maxLines: 2200
  },
  {
    path: 'native-host/src/codexSessionRunner.js',
    maxLines: 1500
  },
  {
    path: 'native-host/src/taskRunner.js',
    maxLines: 1000
  }
]);

export function collectArchitectureBudgetResults(options = {}) {
  const rootDir = path.resolve(options.rootDir || getRepoRoot());
  return ARCHITECTURE_FILE_BUDGETS.map(budget => {
    const fullPath = path.join(rootDir, budget.path);
    const lineCount = fs.existsSync(fullPath) ? countLines(fs.readFileSync(fullPath, 'utf8')) : 0;
    const ceiling = budget.maxLines;
    return {
      path: budget.path,
      lineCount,
      maxLines: budget.maxLines,
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
  const results = collectArchitectureBudgetResults();
  for (const result of results) {
    const status = result.ok ? 'ok' : 'fail';
    console.log(`${status}\ttarget\t${result.lineCount}/${result.ceiling}\t${result.path}`);
  }
  const errors = collectArchitectureBudgetErrors();
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
