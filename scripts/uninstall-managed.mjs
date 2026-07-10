#!/usr/bin/env node
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { uninstallManagedDistribution } = require('../native-host/src/managedInstall.js');
const scriptPath = fileURLToPath(import.meta.url);

export function uninstallManaged(options = {}) {
  return uninstallManagedDistribution(options);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--browser') parsed.browser = readValue(argv, index++, arg);
    else if (arg === '--managed-root') parsed.managedRoot = readValue(argv, index++, arg);
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--help') parsed.help = true;
    else throw new Error('Unknown option: ' + arg);
  }
  return parsed;
}

function readValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error('Missing value for ' + name);
  return value;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log('Usage: uninstall-managed [--browser chrome|chromium|auto] [--managed-root <path>] [--json]');
      return;
    }
    const result = uninstallManaged(args);
    process.stdout.write(args.json ? JSON.stringify(result, null, 2) + '\n' : 'Removed managed Codex Overleaf Link installation.\n');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (path.resolve(process.argv[1] || '') === scriptPath) await main();
