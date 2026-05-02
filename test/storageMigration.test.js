const { test } = require('node:test');
const assert = require('node:assert');

const Migration = require('../extension/src/shared/storageMigration');

test('storageMigration exports PREFS_KEY', () => {
  assert.strictEqual(Migration.PREFS_KEY, 'codexOverleafPrefs');
});

test('storageMigration exports runMigrationIfNeeded', () => {
  assert.strictEqual(typeof Migration.runMigrationIfNeeded, 'function');
});

test('storageMigration exports savePrefs', () => {
  assert.strictEqual(typeof Migration.savePrefs, 'function');
});

test('storageMigration exports loadPrefs', () => {
  assert.strictEqual(typeof Migration.loadPrefs, 'function');
});
