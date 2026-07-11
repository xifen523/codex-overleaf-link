const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadUpdateStatus() {
  const source = fs.readFileSync(path.join(__dirname, '../extension/bootstrap/updateStatus.js'), 'utf8');
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox);
  return sandbox.CodexOverleafUpdateStatus;
}

test('collects and deduplicates every tab and native update blocker', () => {
  const status = loadUpdateStatus();
  const blockers = status.collectBlockers([
    { idle: false, blockers: ['recent_user_activity', 'save_state_unverified'] },
    { idle: false, blockers: ['save_state_unverified', 'dialog'] },
    { idle: true, blockers: [] }
  ], {
    ok: true,
    result: { idle: false, blockers: ['native_project_locked'] }
  });

  assert.deepEqual([...blockers], [
    'recent_user_activity',
    'save_state_unverified',
    'dialog',
    'native_project_locked'
  ]);
});

test('formats actionable copy for known and unknown update blockers', () => {
  const status = loadUpdateStatus();
  assert.equal(
    status.formatBlockers(['tab_probe_unavailable', 'native_run_active']),
    'Reload an Overleaf tab so the updater can verify that it is idle. The native host is still processing a Codex run.'
  );
  assert.equal(status.describeBlocker('future_gate'), 'Update is waiting on: future gate.');
});
