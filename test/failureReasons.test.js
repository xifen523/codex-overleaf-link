'use strict';
const test = require('node:test');
const assert = require('node:assert');
const failureReasons = require('../extension/src/shared/failureReasons.js');

const {
  FAILURE_STAGES,
  FAILURE_SEVERITIES,
  TERMINAL_STATES,
  FAILURE_CODE_CATALOG,
  validateFailureReason,
  normalizeFailureReason
} = failureReasons;

test('FAILURE_STAGES enumerates all 12 stages from the spec', () => {
  assert.deepEqual(Array.from(FAILURE_STAGES).sort(), [
    'accept', 'codex', 'context', 'native', 'navigation', 'preflight',
    'reviewing', 'storage', 'undo', 'unknown', 'verify', 'write'
  ]);
});

test('FAILURE_SEVERITIES enumerates info/warning/error/blocked', () => {
  assert.deepEqual(Array.from(FAILURE_SEVERITIES).sort(), [
    'blocked', 'error', 'info', 'warning'
  ]);
});

test('TERMINAL_STATES enumerates failed/blocked/degraded/needs_review', () => {
  assert.deepEqual(Array.from(TERMINAL_STATES).sort(), [
    'blocked', 'degraded', 'failed', 'needs_review'
  ]);
});

test('catalog includes every §15.4 high-priority code plus target_file_not_found', () => {
  const required = [
    'project_snapshot_unavailable', 'selected_context_unresolved',
    'target_file_not_found', 'target_file_open_failed', 'target_file_not_active',
    'target_editor_not_ready', 'stale_source_changed', 'patch_anchor_not_found',
    'write_observed_mismatch', 'reviewing_state_unknown',
    'editing_not_confirmed', 'tracked_changes_remain', 'undo_not_verified',
    'accept_not_verified', 'native_bridge_unavailable',
    'codex_no_usable_result', 'storage_quota_exceeded'
  ];
  for (const code of required) {
    assert.ok(FAILURE_CODE_CATALOG[code], `catalog missing ${code}`);
    assert.ok(FAILURE_STAGES.has(FAILURE_CODE_CATALOG[code].stage));
    assert.ok(FAILURE_SEVERITIES.has(FAILURE_CODE_CATALOG[code].severity));
  }
});

test('validateFailureReason accepts a complete record', () => {
  const ok = validateFailureReason({
    code: 'target_file_not_active', stage: 'navigation', severity: 'blocked',
    userMessage: 'msg', retryable: true, nextAction: 'do x'
  });
  assert.equal(ok.ok, true, JSON.stringify(ok));
});

test('validateFailureReason rejects unknown stage / severity / terminalState', () => {
  assert.equal(validateFailureReason({
    code: 'x', stage: 'bogus', severity: 'blocked', userMessage: 'm', retryable: false
  }).ok, false);
  assert.equal(validateFailureReason({
    code: 'x', stage: 'write', severity: 'bogus', userMessage: 'm', retryable: false
  }).ok, false);
  assert.equal(validateFailureReason({
    code: 'x', stage: 'write', severity: 'error', userMessage: 'm', retryable: false,
    terminalState: 'whatever'
  }).ok, false);
});

test('validateFailureReason rejects disallowed severity/terminalState pair', () => {
  // blocked terminalState + non-blocked severity is illegal per §7 allowed combos.
  assert.equal(validateFailureReason({
    code: 'x', stage: 'preflight', severity: 'error', userMessage: 'm', retryable: false,
    terminalState: 'blocked'
  }).ok, false);
  // needs_review + info is illegal (only warning/error allowed).
  assert.equal(validateFailureReason({
    code: 'x', stage: 'verify', severity: 'info', userMessage: 'm', retryable: false,
    terminalState: 'needs_review'
  }).ok, false);
});

test('validateFailureReason requires nextAction when retryable=true', () => {
  assert.equal(validateFailureReason({
    code: 'x', stage: 'navigation', severity: 'blocked', userMessage: 'm',
    retryable: true
  }).ok, false);
});

test('normalizeFailureReason returns explicit failure when valid', () => {
  const reason = normalizeFailureReason({
    ok: false,
    failure: {
      code: 'target_file_not_active', stage: 'navigation', severity: 'blocked',
      userMessage: 'msg', retryable: true, nextAction: 'open file'
    }
  });
  assert.equal(reason.code, 'target_file_not_active');
  assert.equal(reason.stage, 'navigation');
});

test('normalizeFailureReason maps legacy code path_not_found → target_file_not_found', () => {
  const reason = normalizeFailureReason({
    ok: false, code: 'path_not_found', reason: 'Cannot find example/test.tex'
  }, { path: 'example/test.tex', type: 'edit' });
  assert.equal(reason.code, 'target_file_not_found');
  assert.equal(reason.stage, 'navigation');
  assert.equal(reason.file, 'example/test.tex');
  assert.equal(reason.evidence.originalCode, 'path_not_found');
});

test('normalizeFailureReason maps reviewing_not_enabled with toggleAttempted → reviewing_enable_failed', () => {
  const reason = normalizeFailureReason({
    ok: false,
    code: 'reviewing_not_enabled',
    evidence: { toggleAttempted: true }
  });
  assert.equal(reason.code, 'reviewing_enable_failed');
  assert.equal(reason.stage, 'reviewing');
});

test('normalizeFailureReason maps reviewing_not_enabled without toggleAttempted → reviewing_state_unknown', () => {
  const reason = normalizeFailureReason({
    ok: false, code: 'reviewing_not_enabled'
  });
  assert.equal(reason.code, 'reviewing_state_unknown');
});

test('normalizeFailureReason repairs malformed legacy result without throwing', () => {
  const reason = normalizeFailureReason(null);
  assert.equal(reason.code, 'unknown_legacy_failure');
  assert.equal(reason.stage, 'unknown');
  assert.equal(reason.severity, 'error');
  assert.ok(reason.userMessage);
  assert.equal(reason.retryable, false);
});

test('normalizeFailureReason preserves operation type and file when available', () => {
  const reason = normalizeFailureReason(
    { ok: false, code: 'file_open_failed', reason: 'foo' },
    { type: 'edit', path: 'main.tex' }
  );
  assert.equal(reason.operationType, 'edit');
  assert.equal(reason.file, 'main.tex');
});
