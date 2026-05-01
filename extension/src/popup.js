(function initPopup() {
  'use strict';

  const button = document.getElementById('open-panel');
  const status = document.getElementById('status');

  button.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https:\/\/(www\.)?overleaf\.com\/project\//.test(tab.url || '')) {
      status.textContent = 'Open an Overleaf project tab first.';
      return;
    }

    await chrome.tabs.sendMessage(tab.id, { type: 'codex-overleaf/open-panel' });
    window.close();
  });
})();
