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
  doctor            Check local native host setup
  version           Print the package version
  help              Show this help message`);
}

function notImplemented(name) {
  console.error(`${name} is not implemented yet.`);
  process.exit(1);
}

function parseDoctorArgs(argv) {
  const parsed = {
    browser: 'auto',
    json: false,
    revealPaths: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--reveal-paths') {
      parsed.revealPaths = true;
    } else if (arg === '--browser') {
      parsed.browser = readOptionValue(argv, index, arg);
      index += 1;
    } else if (arg === '--runtime-root') {
      parsed.runtimeRoot = readOptionValue(argv, index, arg);
      index += 1;
    } else {
      throw new Error(`Unknown doctor option: ${arg}`);
    }
  }

  if (!['auto', 'chrome', 'chromium'].includes(parsed.browser)) {
    throw new Error('Usage: codex-overleaf-link doctor [--json] [--browser chrome|chromium|auto] [--runtime-root <path>] [--reveal-paths]');
  }

  return parsed;
}

function readOptionValue(argv, index, optionName) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${optionName}`);
  }
  return value;
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
    notImplemented(command);
    break;
  case 'doctor': {
    const { formatDoctorHuman, runDoctor } = require('../native-host/src/nativeDoctor.js');
    let doctorArgs;
    try {
      doctorArgs = parseDoctorArgs(args);
    } catch (error) {
      console.error(error.message);
      process.exit(2);
    }

    let result;
    try {
      result = await runDoctor(doctorArgs);
    } catch (error) {
      console.error(`Doctor failed: ${error.message}`);
      process.exit(3);
    }
    if (doctorArgs.json) {
      console.log(JSON.stringify(result.body, null, 2));
    } else {
      process.stdout.write(formatDoctorHuman(result.body));
    }
    process.exit(result.exitCode);
    break;
  }
  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}
