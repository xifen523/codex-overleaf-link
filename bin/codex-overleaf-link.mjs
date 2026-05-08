#!/usr/bin/env node
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json');

const command = process.argv[2] ?? 'help';
const args = process.argv.slice(3);

function printHelp() {
  console.log(`codex-overleaf-link ${packageJson.version}

Commands:
  install-native    Install the native host (not implemented yet)
  uninstall-native  Uninstall the native host (not implemented yet)
  doctor            Check local setup (not implemented yet)
  version           Print the package version
  help              Show this help message`);
}

function notImplemented(name) {
  console.error(`${name} is not implemented yet.`);
  process.exit(1);
}

switch (command) {
  case 'help':
    printHelp();
    break;
  case 'version':
    if (args.includes('--json')) {
      console.log(JSON.stringify({ packageVersion: packageJson.version }));
    } else {
      console.log(packageJson.version);
    }
    break;
  case 'install-native':
  case 'uninstall-native':
  case 'doctor':
    notImplemented(command);
    break;
  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}
