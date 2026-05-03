(function initPopup() {
  'use strict';

  const INSTALL_COMMAND = 'curl -fsSL https://raw.githubusercontent.com/Ghqqqq/codex-overleaf-link/main/install.sh | bash';
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
          params: {}
        }
      });
      if (response?.ok) {
        nativeInstall.hidden = true;
        status.textContent = 'Native host connected. Open an Overleaf project tab to use Codex.';
        return;
      }
      showNativeInstallGuide();
    } catch (_error) {
      showNativeInstallGuide();
    }
  }

  function showNativeInstallGuide() {
    nativeInstall.hidden = false;
    status.textContent = 'Install the local native host before running Codex.';
  }
})();
