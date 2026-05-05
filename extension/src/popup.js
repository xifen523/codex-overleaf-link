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

  installCommand.textContent = INSTALL_COMMAND;

  button.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https:\/\/(www\.)?overleaf\.com\/project\//.test(tab.url || '')) {
      status.textContent = 'Open an Overleaf project tab first.';
      return;
    }

    await chrome.tabs.sendMessage(tab.id, { type: 'codex-overleaf/open-panel' });
    window.close();
  });

  copyInstallCommand.addEventListener('click', async () => {
    await navigator.clipboard.writeText(INSTALL_COMMAND);
    copyInstallCommand.textContent = 'Copied';
    setTimeout(() => {
      copyInstallCommand.textContent = 'Copy install command';
    }, 1400);
  });

  checkNativeHost();

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
