'use strict';

const updateState = document.getElementById('update-state');
const updateVersions = document.getElementById('update-versions');
const updateDetail = document.getElementById('update-detail');
const checkButton = document.getElementById('check-update');
const postponeButton = document.getElementById('postpone-update');
const UpdateStatus = globalThis.CodexOverleafUpdateStatus;

checkButton.addEventListener('click', async () => {
  checkButton.disabled = true;
  updateState.textContent = 'Checking';
  await chrome.runtime.sendMessage({ type: 'codex-overleaf/update-check-now' }).catch(() => null);
  checkButton.disabled = false;
  await refreshUpdateState();
});

postponeButton.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'codex-overleaf/update-postpone' }).catch(() => null);
  await refreshUpdateState();
});

refreshUpdateState();

async function refreshUpdateState() {
  const state = await chrome.runtime.sendMessage({ type: 'codex-overleaf/update-get-state' }).catch(() => null);
  if (!state) {
    updateState.textContent = 'Unavailable';
    return;
  }
  updateState.textContent = String(state.state || 'idle').replaceAll('_', ' ');
  updateVersions.textContent = 'Current v' + (state.currentVersion || 'unknown') + ' · Latest v' + (state.latestVersion || 'unknown');
  postponeButton.hidden = !['update_available', 'downloading', 'verifying', 'staged', 'waiting_for_idle'].includes(state.state);
  if (state.managed === false) {
    updateDetail.textContent = 'Run install-managed once to enable automatic extension and native-host updates.';
  } else if (state.state === 'waiting_for_idle') {
    const blockerDetail = UpdateStatus?.formatBlockers(state.blockers || [state.blocker]) || '';
    updateDetail.textContent = blockerDetail
      ? `Downloaded and verified. ${blockerDetail}`
      : 'Downloaded and verified. Waiting until every Overleaf tab is saved and idle.';
  } else if (state.state === 'rolled_back') {
    updateDetail.textContent = 'The previous version was restored after a failed health check.';
  } else if (state.state === 'committed') {
    updateDetail.textContent = 'The extension and native host were updated together.';
  } else {
    updateDetail.textContent = 'Automatic stable updates apply when Overleaf is saved and idle.';
  }
}
