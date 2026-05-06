'use strict';

const os = require('node:os');
const path = require('node:path');

const HOST_NAME = 'com.codex.overleaf';

const MACOS_MANIFEST_DIRS = {
  chrome: 'Library/Application Support/Google/Chrome/NativeMessagingHosts'
};

const LINUX_MANIFEST_DIRS = {
  chrome: '.config/google-chrome/NativeMessagingHosts',
  chromium: '.config/chromium/NativeMessagingHosts'
};

const WINDOWS_REGISTRY_PATHS = {
  chrome: 'Software\\Google\\Chrome\\NativeMessagingHosts'
};

function getNativeHostPlatform(options = {}) {
  return options.platform || process.platform;
}

function getCodexOverleafHome(options = {}) {
  const platform = getNativeHostPlatform(options);
  if (platform === 'win32') {
    return path.win32.join(getWindowsLocalAppData(options), 'CodexOverleaf');
  }
  if (platform === 'darwin' || platform === 'linux') {
    return path.posix.join(getHomeDir(options), '.codex-overleaf');
  }
  throwUnsupportedPlatform(platform);
}

function getDefaultRuntimeRoot(options = {}) {
  const platformPath = getPathModule(options);
  return platformPath.join(getCodexOverleafHome(options), 'native-host-runtime');
}

function getDefaultBridgePath(options = {}) {
  const platformPath = getPathModule(options);
  const bridgeName = getNativeHostPlatform(options) === 'win32'
    ? 'codex-overleaf-bridge.cmd'
    : 'codex-overleaf-bridge';
  return platformPath.join(getCodexOverleafHome(options), bridgeName);
}

function getNativeHostRegistrationTarget(options = {}) {
  const platform = getNativeHostPlatform(options);
  const browser = getNativeHostBrowser(options);
  const manifestPath = getNativeManifestPath({ ...options, browser });

  if (platform === 'darwin' || platform === 'linux') {
    return {
      kind: 'file',
      browser,
      manifestPath
    };
  }

  if (platform === 'win32') {
    const registryPath = WINDOWS_REGISTRY_PATHS[browser];
    if (!registryPath) {
      throwUnsupportedBrowser(platform, browser);
    }
    return {
      kind: 'registry',
      root: 'HKCU',
      registryKey: `HKCU\\${registryPath}\\${HOST_NAME}`,
      manifestPath
    };
  }

  throwUnsupportedPlatform(platform);
}

function getNativeManifestPath(options = {}) {
  const platform = getNativeHostPlatform(options);
  const browser = getNativeHostBrowser(options);

  if (platform === 'darwin') {
    const manifestDir = MACOS_MANIFEST_DIRS[browser];
    if (!manifestDir) {
      throwUnsupportedBrowser(platform, browser);
    }
    return path.posix.join(getHomeDir(options), manifestDir, `${HOST_NAME}.json`);
  }

  if (platform === 'linux') {
    const manifestDir = LINUX_MANIFEST_DIRS[browser];
    if (!manifestDir) {
      throwUnsupportedBrowser(platform, browser);
    }
    return path.posix.join(getHomeDir(options), manifestDir, `${HOST_NAME}.json`);
  }

  if (platform === 'win32') {
    if (!WINDOWS_REGISTRY_PATHS[browser]) {
      throwUnsupportedBrowser(platform, browser);
    }
    return path.win32.join(getDefaultRuntimeRoot(options), `${HOST_NAME}.json`);
  }

  throwUnsupportedPlatform(platform);
}

function getNativeHostBrowser(options) {
  return options.browser || 'chrome';
}

function getHomeDir(options) {
  const env = options.env || process.env;
  if (getNativeHostPlatform(options) === 'win32') {
    return options.homeDir || env.USERPROFILE || env.HOME || os.homedir();
  }
  return options.homeDir || env.HOME || env.USERPROFILE || os.homedir();
}

function getWindowsLocalAppData(options) {
  const env = options.env || process.env;
  if (env.LOCALAPPDATA) {
    return env.LOCALAPPDATA;
  }
  return path.win32.join(getHomeDir(options), 'AppData', 'Local');
}

function getPathModule(options) {
  return getNativeHostPlatform(options) === 'win32' ? path.win32 : path.posix;
}

function throwUnsupportedPlatform(platform) {
  throw new Error(`Unsupported native host platform: ${platform}`);
}

function throwUnsupportedBrowser(platform, browser) {
  throw new Error(`Unsupported native host browser for ${platform}: ${browser}`);
}

module.exports = {
  getCodexOverleafHome,
  getDefaultBridgePath,
  getDefaultRuntimeRoot,
  getHomeDir,
  getNativeHostPlatform,
  getNativeHostRegistrationTarget,
  getNativeManifestPath
};
