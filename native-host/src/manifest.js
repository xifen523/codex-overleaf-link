'use strict';

const os = require('node:os');
const path = require('node:path');

const HOST_NAME = 'com.codex.overleaf';
const HOST_DESCRIPTION = 'Codex Overleaf local bridge';
const DEFAULT_CHROME_EXTENSION_ID = 'illdpneeeopfffmiepaejglgmhpmdhdc';

function validateChromeExtensionId(extensionId) {
  return /^[a-p]{32}$/.test(extensionId);
}

function buildHostManifest({ extensionId, bridgePath }) {
  if (!validateChromeExtensionId(extensionId)) {
    throw new Error(`Invalid Chrome extension id: ${extensionId}`);
  }
  if (!bridgePath || !path.isAbsolute(bridgePath)) {
    throw new Error('Native bridge path must be absolute');
  }

  return {
    name: HOST_NAME,
    description: HOST_DESCRIPTION,
    path: bridgePath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extensionId}/`]
  };
}

function getChromeNativeHostManifestPath() {
  return path.join(
    os.homedir(),
    'Library/Application Support/Google/Chrome/NativeMessagingHosts',
    `${HOST_NAME}.json`
  );
}

module.exports = {
  DEFAULT_CHROME_EXTENSION_ID,
  HOST_DESCRIPTION,
  HOST_NAME,
  buildHostManifest,
  getChromeNativeHostManifestPath,
  validateChromeExtensionId
};
