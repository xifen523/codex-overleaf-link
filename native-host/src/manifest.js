'use strict';

const path = require('node:path');
const { getNativeManifestPath } = require('./nativeHostPlatform');

const HOST_NAME = 'com.codex.overleaf';
const HOST_DESCRIPTION = 'Codex Overleaf local bridge';
const DEFAULT_CHROME_EXTENSION_ID = 'illdpneeeopfffmiepaejglgmhpmdhdc';

function validateChromeExtensionId(extensionId) {
  return /^[a-p]{32}$/.test(extensionId);
}

function buildHostManifest({ extensionId, extensionIds, bridgePath, platform = process.platform }) {
  const ids = normalizeExtensionIds(extensionIds || [extensionId]);
  if (!ids.length) {
    throw new Error(`Invalid Chrome extension id: ${extensionId}`);
  }
  if (!bridgePath || !isAbsolutePathForPlatform(bridgePath, platform)) {
    throw new Error('Native bridge path must be absolute');
  }

  return {
    name: HOST_NAME,
    description: HOST_DESCRIPTION,
    path: bridgePath,
    type: 'stdio',
    allowed_origins: ids.map(id => `chrome-extension://${id}/`)
  };
}

function normalizeExtensionIds(extensionIds) {
  const seen = new Set();
  const ids = [];
  for (const value of Array.isArray(extensionIds) ? extensionIds : [extensionIds]) {
    const id = String(value || '').trim();
    if (!id || seen.has(id)) {
      continue;
    }
    if (!validateChromeExtensionId(id)) {
      throw new Error(`Invalid Chrome extension id: ${id}`);
    }
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function isAbsolutePathForPlatform(targetPath, platform = process.platform) {
  if (platform === 'win32') {
    return path.win32.isAbsolute(targetPath);
  }
  if (platform === 'darwin' || platform === 'linux') {
    return path.posix.isAbsolute(targetPath);
  }
  return path.isAbsolute(targetPath);
}

function getChromeNativeHostManifestPath(options = {}) {
  return getNativeManifestPath({
    ...options,
    platform: 'darwin',
    browser: 'chrome'
  });
}

module.exports = {
  DEFAULT_CHROME_EXTENSION_ID,
  HOST_DESCRIPTION,
  HOST_NAME,
  buildHostManifest,
  getChromeNativeHostManifestPath,
  normalizeExtensionIds,
  validateChromeExtensionId
};
