(function initPopup() {
  'use strict';

  const CodexOverleafCompatibility = window.CodexOverleafCompatibility;
  const DEFAULT_INSTALL_COMMAND = CodexOverleafCompatibility?.buildInstallCommand?.(
    undefined,
    undefined,
    getCurrentExtensionId()
  ) || 'curl -fsSL https://raw.githubusercontent.com/xifen523/codex-overleaf-link/main/install.sh | bash -s -- --extension-id <chrome-extension-id>';
  const button = document.getElementById('open-panel');
  const status = document.getElementById('status');
  const compatStatusIcon = document.getElementById('compat-status-icon');
  const versionPair = document.getElementById('version-pair');
  const nativeInstall = document.getElementById('native-install');
  const installCommand = document.getElementById('install-command');
  const copyInstallCommand = document.getElementById('copy-install-command');
  let activeOverleafTab = null;
  let currentInstallCommand = DEFAULT_INSTALL_COMMAND;

  installCommand.textContent = currentInstallCommand;
  button.textContent = 'Open panel in Overleaf';
  setVersionStatus({
    status: 'native_missing',
    classification: 'incompatible',
    extensionVersion: getExtensionCompatibilityMetadata().version
  });

  button.addEventListener('click', async () => {
    const tab = activeOverleafTab || await getActiveOverleafProjectTab();
    if (!tab?.id) {
      status.textContent = 'Open an Overleaf project tab first.';
      return;
    }

    await chrome.tabs.sendMessage(tab.id, { type: 'codex-overleaf/toggle-panel' });
    window.close();
  });

  copyInstallCommand.addEventListener('click', async () => {
    await navigator.clipboard.writeText(currentInstallCommand);
    copyInstallCommand.textContent = 'Copied';
    setTimeout(() => {
      copyInstallCommand.textContent = 'Copy install command';
    }, 1400);
  });

  initPopupState();

  async function initPopupState() {
    await checkNativeHost();
    await refreshPanelButtonState();
  }

  async function refreshPanelButtonState() {
    const tab = await getActiveOverleafProjectTab();
    activeOverleafTab = tab;
    if (!tab?.id) {
      button.textContent = 'Open panel in Overleaf';
      return;
    }

    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'codex-overleaf/get-panel-state' });
      const open = response?.open === true;
      button.textContent = open ? 'Close panel in Overleaf' : 'Open panel in Overleaf';
      status.textContent = open
        ? 'Panel is open in this Overleaf tab.'
        : 'Panel is closed in this Overleaf tab.';
    } catch (_error) {
      button.textContent = 'Open panel in Overleaf';
      status.textContent = 'Refresh the Overleaf tab, then open the panel.';
    }
  }

  async function getActiveOverleafProjectTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id && isOverleafProjectUrl(tab.url) ? tab : null;
  }

  function isOverleafProjectUrl(url) {
    return /^https:\/\/(www\.)?overleaf\.com\/project\//.test(String(url || ''));
  }

  async function checkNativeHost() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'codex-overleaf/native-request',
        payload: {
          id: crypto.randomUUID(),
          method: 'bridge.ping',
          params: CodexOverleafCompatibility?.buildBridgePingParams?.(getExtensionCompatibilityMetadata()) || {}
        }
      });
      const compatibility = evaluateNativeCompatibility(response);
      setVersionStatus(compatibility);
      if (getCompatibilityClassification(compatibility) === 'compatible') {
        nativeInstall.hidden = true;
        status.textContent = 'Native host connected. Open an Overleaf project tab to use Codex.';
        return;
      }
      showNativeInstallGuide(compatibility);
    } catch (_error) {
      const compatibility = {
        status: 'native_missing',
        classification: 'incompatible',
        installCommand: DEFAULT_INSTALL_COMMAND,
        updateCommand: DEFAULT_INSTALL_COMMAND,
        extensionVersion: getExtensionCompatibilityMetadata().version
      };
      setVersionStatus(compatibility);
      showNativeInstallGuide(compatibility);
    }
  }

  function showNativeInstallGuide(compatibility = {}) {
    nativeInstall.hidden = false;
    currentInstallCommand = getCompatibilityUpdateCommand(compatibility);
    installCommand.textContent = currentInstallCommand;
    status.textContent = getNativeStatusMessage(compatibility.status, getCompatibilityClassification(compatibility));
  }

  function evaluateNativeCompatibility(response) {
    if (CodexOverleafCompatibility?.evaluateNativeCompatibility) {
      return CodexOverleafCompatibility.evaluateNativeCompatibility(response, getExtensionCompatibilityMetadata());
    }
    return response?.ok
      ? {
          status: 'ok',
          classification: 'compatible',
          native: response.result,
          nativeVersion: response.result?.version,
          currentNativeVersion: response.result?.version,
          installCommand: DEFAULT_INSTALL_COMMAND,
          updateCommand: DEFAULT_INSTALL_COMMAND,
          extensionVersion: getExtensionCompatibilityMetadata().version
        }
      : {
          status: 'native_missing',
          classification: 'incompatible',
          native: response,
          installCommand: DEFAULT_INSTALL_COMMAND,
          updateCommand: DEFAULT_INSTALL_COMMAND,
          extensionVersion: getExtensionCompatibilityMetadata().version
        };
  }

  function setVersionStatus(compatibility = {}) {
    const classification = getCompatibilityClassification(compatibility);
    const extensionVersion = compatibility.extensionVersion || getExtensionCompatibilityMetadata().version;
    const nativeVersion = compatibility.currentNativeVersion || compatibility.nativeVersion || compatibility.native?.version;
    versionPair.textContent = `Extension ${formatVersion(extensionVersion)} / Native ${formatVersion(nativeVersion)}`;
    compatStatusIcon.textContent = getStatusIconText(classification);
    compatStatusIcon.className = `status-icon ${classification}`;
    compatStatusIcon.title = getCompatibilityStatusTitle(classification);
    if (compatStatusIcon.dataset) {
      compatStatusIcon.dataset.status = classification;
    }
    compatStatusIcon.setAttribute?.('aria-label', compatStatusIcon.title);
  }

  function getExtensionCompatibilityMetadata() {
    return {
      version: CodexOverleafCompatibility?.BUILD_TARGET_VERSION ||
        chrome.runtime.getManifest?.().version ||
        '',
      extensionId: getCurrentExtensionId()
    };
  }

  function getCurrentExtensionId() {
    return typeof chrome === 'object' && chrome?.runtime?.id
      ? chrome.runtime.id
      : '';
  }

  function getCompatibilityClassification(compatibility = {}) {
    const classification = compatibility.classification || compatibility.status;
    switch (classification) {
      case 'compatible':
      case 'update-available':
      case 'incompatible':
        return classification;
      case 'ok':
        return 'compatible';
      default:
        return 'incompatible';
    }
  }

  function getCompatibilityUpdateCommand(compatibility = {}) {
    return CodexOverleafCompatibility?.buildInstallCommand?.(
      compatibility.recommendedVersion || CodexOverleafCompatibility.BUILD_TARGET_VERSION,
      compatibility.native?.platform || compatibility.platform,
      getCurrentExtensionId()
    ) || compatibility.updateCommand || compatibility.installCommand || DEFAULT_INSTALL_COMMAND;
  }

  function getStatusIconText(classification) {
    switch (classification) {
      case 'compatible':
        return 'OK';
      case 'update-available':
        return '!';
      default:
        return 'X';
    }
  }

  function getCompatibilityStatusTitle(classification) {
    switch (classification) {
      case 'compatible':
        return 'Native host compatible';
      case 'update-available':
        return 'Native host update available';
      default:
        return 'Native host incompatible';
    }
  }

  function formatVersion(version) {
    const value = String(version || '').trim();
    if (!value) {
      return 'unknown';
    }
    return value.startsWith('v') ? value : `v${value}`;
  }

  function getNativeStatusMessage(statusValue, classification) {
    if (classification === 'update-available') {
      return 'Native host update available. Run the update command, then reload the extension.';
    }
    switch (statusValue) {
      case 'native_too_old':
        return 'Native host update required. Run the install command, then reload the extension.';
      case 'protocol_unsupported':
        return 'Native host protocol mismatch. Update the native host and extension together.';
      case 'extension_too_old':
        return 'Extension update required. Update the Chrome extension before running Codex.';
      case 'native_unhealthy':
        return 'Native host connected, but local Codex is not ready. Check the panel diagnostics.';
      case 'native_missing':
        return 'Install the local native host before running Codex.';
      default:
        return 'Native host is not compatible. Update the native host, then reload the extension.';
    }
  }
})();
