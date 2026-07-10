#!/usr/bin/env node
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json');
const packageRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

let command = process.argv[2] ?? 'help';
const args = process.argv.slice(3);

if (command === '--help') {
  command = 'help';
}

function printHelp() {
  console.log(`codex-overleaf-link ${packageJson.version}

Commands:
  install-managed   Install the managed extension and native host
  uninstall-managed Remove the managed extension and native host
  install-native    Install the native host
  uninstall-native  Uninstall the native host
  doctor            Check local native host setup
  version           Print the package version
  help              Show this help message`);
}

const OPTION_DEFINITIONS = {
  '--extension-id': { key: 'extensionId', takesValue: true },
  '--browser': { key: 'browser', takesValue: true },
  '--runtime-root': { key: 'runtimeRoot', takesValue: true },
  '--managed-root': { key: 'managedRoot', takesValue: true },
  '--force': { key: 'force', takesValue: false },
  '--keep-runtime': { key: 'keepRuntime', takesValue: false },
  '--reveal-paths': { key: 'revealPaths', takesValue: false },
  '--json': { key: 'json', takesValue: false },
  '--help': { key: 'help', takesValue: false }
};

const INSTALL_NATIVE_OPTIONS = new Set([
  '--extension-id',
  '--browser',
  '--runtime-root',
  '--force',
  '--reveal-paths',
  '--json',
  '--help'
]);

const UNINSTALL_NATIVE_OPTIONS = new Set([
  '--browser',
  '--runtime-root',
  '--force',
  '--keep-runtime',
  '--reveal-paths',
  '--json',
  '--help'
]);

const INSTALL_MANAGED_OPTIONS = new Set([
  '--extension-id',
  '--browser',
  '--managed-root',
  '--json',
  '--help'
]);

const UNINSTALL_MANAGED_OPTIONS = new Set([
  '--browser',
  '--managed-root',
  '--json',
  '--help'
]);

function parseNativeArgs(argv, allowedOptions) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const definition = OPTION_DEFINITIONS[arg];
    if (!definition || !allowedOptions.has(arg)) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (definition.takesValue) {
      parsed[definition.key] = readOptionValue(argv, index, arg);
      index += 1;
    } else {
      parsed[definition.key] = true;
    }
  }

  validateBrowserOption(parsed.browser);
  return parsed;
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

function validateBrowserOption(browser) {
  if (browser && !['auto', 'chrome', 'chromium'].includes(browser)) {
    throw new Error('Usage: --browser must be one of chrome, chromium, or auto');
  }
}

function exitWithError(error) {
  console.error(error instanceof Error ? error.message : String(error));
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
  case 'install-managed': {
    let installArgs;
    try {
      installArgs = parseNativeArgs(args, INSTALL_MANAGED_OPTIONS);
    } catch (error) {
      exitWithError(error);
    }
    if (installArgs.help) {
      printHelp();
      break;
    }
    try {
      const { formatInstallManagedHuman, installManaged } = await import('../scripts/install-managed.mjs');
      const result = installManaged({ ...installArgs, packageRoot });
      process.stdout.write(installArgs.json ? JSON.stringify(result, null, 2) + '\n' : formatInstallManagedHuman(result));
    } catch (error) {
      exitWithError(error);
    }
    break;
  }
  case 'uninstall-managed': {
    let uninstallArgs;
    try {
      uninstallArgs = parseNativeArgs(args, UNINSTALL_MANAGED_OPTIONS);
    } catch (error) {
      exitWithError(error);
    }
    if (uninstallArgs.help) {
      printHelp();
      break;
    }
    try {
      const { uninstallManaged } = await import('../scripts/uninstall-managed.mjs');
      const result = uninstallManaged(uninstallArgs);
      process.stdout.write(uninstallArgs.json ? JSON.stringify(result, null, 2) + '\n' : 'Removed managed Codex Overleaf Link installation.\n');
    } catch (error) {
      exitWithError(error);
    }
    break;
  }
  case 'install-native': {
    let installArgs;
    try {
      installArgs = parseNativeArgs(args, INSTALL_NATIVE_OPTIONS);
    } catch (error) {
      exitWithError(error);
    }
    if (installArgs.help) {
      printHelp();
      break;
    }

    try {
      const { formatInstallNativeHostHuman, installNativeHost } = await import('../scripts/install-native-host.mjs');
      const result = installNativeHost({
        ...installArgs,
        packageRoot
      });
      if (installArgs.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        process.stdout.write(formatInstallNativeHostHuman(result));
      }
    } catch (error) {
      exitWithError(error);
    }
    break;
  }
  case 'uninstall-native': {
    let uninstallArgs;
    try {
      uninstallArgs = parseNativeArgs(args, UNINSTALL_NATIVE_OPTIONS);
    } catch (error) {
      exitWithError(error);
    }
    if (uninstallArgs.help) {
      printHelp();
      break;
    }

    try {
      const { formatUninstallNativeHostHuman, uninstallNativeHost } = await import('../scripts/uninstall-native-host.mjs');
      const result = uninstallNativeHost(uninstallArgs);
      if (uninstallArgs.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        process.stdout.write(formatUninstallNativeHostHuman(result));
      }
    } catch (error) {
      exitWithError(error);
    }
    break;
  }
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
