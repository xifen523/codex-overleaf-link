const assert = require('node:assert/strict');
const test = require('node:test');

const policy = require('../extension/src/shared/updateConsent');

test('automatic discovery view offers an update without inventing execution progress', () => {
  const view = policy.deriveViewModel({
    state: 'update_available',
    currentVersion: '1.9.4',
    latestVersion: '1.9.5'
  }, {}, { now: 1000 });
  assert.equal(view.available, true);
  assert.equal(view.progress.value, 0);
  assert.equal(view.actions.install, true);
  assert.equal(view.showPanel, true);
  assert.deepEqual(view.badge, { text: 'UP', color: '#3578bd' });
});

test('snooze is target-bound and a newer target reopens the panel offer', () => {
  const consent = {
    snoozedVersion: '1.9.5',
    snoozedUntil: 10_000
  };
  const snoozed = policy.deriveViewModel({
    state: 'update_available',
    currentVersion: '1.9.4',
    latestVersion: '1.9.5'
  }, consent, { now: 1000 });
  const newer = policy.deriveViewModel({
    state: 'update_available',
    currentVersion: '1.9.4',
    latestVersion: '1.9.6'
  }, consent, { now: 1000 });
  assert.equal(snoozed.snoozed, true);
  assert.equal(snoozed.showPanel, false);
  assert.equal(newer.snoozed, false);
  assert.equal(newer.showPanel, true);
});

test('phase progress distinguishes indeterminate work from safe waiting', () => {
  assert.deepEqual(policy.getProgressModel({ state: 'downloading' }), {
    value: 35,
    determinate: false,
    phase: 'downloading',
    blocker: '',
    code: '',
    message: ''
  });
  assert.equal(policy.getProgressModel({
    state: 'waiting_for_idle',
    blocker: 'unsaved'
  }).value, 65);
  assert.equal(policy.getProgressModel({ state: 'committed' }).value, 100);
});
