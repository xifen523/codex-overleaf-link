(function initPopup() {
  'use strict';

  const CodexOverleafCompatibility = window.CodexOverleafCompatibility;
  const INSTALL_COMMAND = CodexOverleafCompatibility?.buildInstallCommand?.() ||
    'curl -fsSL https://raw.githubusercontent.com/Ghqqqq/codex-overleaf-link/main/install.sh | bash';
  const button = document.getElementById('open-panel');
  const status = document.getElementById('status');
  const nativeInstall = document.getElementById('native-install');
  const installCommand = document.getElementById('install-command');
  const copyInstallCommand = document.getElementById('copy-install-command');
  let activeOverleafTab = null;

  installCommand.textContent = INSTALL_COMMAND;
  button.textContent = 'Open panel in Overleaf';

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
    await navigator.clipboard.writeText(INSTALL_COMMAND);
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
      if (compatibility.status === 'ok') {
        nativeInstall.hidden = true;
        status.textContent = 'Native host connected. Open an Overleaf project tab to use Codex.';
        return;
      }
      showNativeInstallGuide(compatibility);
    } catch (_error) {
      showNativeInstallGuide({ status: 'native_missing', installCommand: INSTALL_COMMAND });
    }
  }

  function showNativeInstallGuide(compatibility = {}) {
    nativeInstall.hidden = false;
    installCommand.textContent = compatibility.installCommand || INSTALL_COMMAND;
    status.textContent = getNativeStatusMessage(compatibility.status);
  }

  function evaluateNativeCompatibility(response) {
    if (CodexOverleafCompatibility?.evaluateNativeCompatibility) {
      return CodexOverleafCompatibility.evaluateNativeCompatibility(response, getExtensionCompatibilityMetadata());
    }
    return response?.ok
      ? { status: 'ok', native: response.result, installCommand: INSTALL_COMMAND }
      : { status: 'native_missing', native: response, installCommand: INSTALL_COMMAND };
  }

  function getExtensionCompatibilityMetadata() {
    return {
      version: CodexOverleafCompatibility?.BUILD_TARGET_VERSION ||
        chrome.runtime.getManifest?.().version ||
        ''
    };
  }

  function getNativeStatusMessage(statusValue) {
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
