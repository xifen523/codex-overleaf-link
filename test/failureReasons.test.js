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

const {
  STAGE_TIE_BREAKER_ORDER,
  SEVERITY_ORDER,
  selectPrimaryFailure,
  localizeFailureReason
} = failureReasons;

test('STAGE_TIE_BREAKER_ORDER lists all 12 stages in design-spec order', () => {
  assert.deepEqual(STAGE_TIE_BREAKER_ORDER, [
    'native', 'navigation', 'preflight', 'write', 'verify',
    'reviewing', 'accept', 'undo', 'storage', 'codex', 'context', 'unknown'
  ]);
});

test('SEVERITY_ORDER ranks blocked < error < warning < info', () => {
  assert.ok(SEVERITY_ORDER.blocked < SEVERITY_ORDER.error);
  assert.ok(SEVERITY_ORDER.error < SEVERITY_ORDER.warning);
  assert.ok(SEVERITY_ORDER.warning < SEVERITY_ORDER.info);
});

test('selectPrimaryFailure returns null for empty or non-array input', () => {
  assert.equal(selectPrimaryFailure([]), null);
  assert.equal(selectPrimaryFailure(null), null);
  assert.equal(selectPrimaryFailure(undefined), null);
});

test('selectPrimaryFailure prefers blocked over error over warning over info', () => {
  const failures = [
    { code: 'a', stage: 'codex', severity: 'info', userMessage: 'm', retryable: false },
    { code: 'b', stage: 'codex', severity: 'warning', userMessage: 'm', retryable: false },
    { code: 'c', stage: 'codex', severity: 'blocked', userMessage: 'm', retryable: false },
    { code: 'd', stage: 'codex', severity: 'error', userMessage: 'm', retryable: false }
  ];
  assert.equal(selectPrimaryFailure(failures).code, 'c');
});

test('selectPrimaryFailure tie-breaks by stage order: native blocked beats navigation blocked', () => {
  const failures = [
    { code: 'nav', stage: 'navigation', severity: 'blocked', userMessage: 'm', retryable: false },
    { code: 'nat', stage: 'native', severity: 'blocked', userMessage: 'm', retryable: false }
  ];
  assert.equal(selectPrimaryFailure(failures).code, 'nat');
});

test('selectPrimaryFailure tie-breaks navigation blocked over preflight blocked', () => {
  const failures = [
    { code: 'pre', stage: 'preflight', severity: 'blocked', userMessage: 'm', retryable: false },
    { code: 'nav', stage: 'navigation', severity: 'blocked', userMessage: 'm', retryable: false }
  ];
  assert.equal(selectPrimaryFailure(failures).code, 'nav');
});

test('selectPrimaryFailure prefers blocked navigation over error navigation', () => {
  const failures = [
    { code: 'navE', stage: 'navigation', severity: 'error', userMessage: 'm', retryable: false },
    { code: 'navB', stage: 'navigation', severity: 'blocked', userMessage: 'm', retryable: false }
  ];
  assert.equal(selectPrimaryFailure(failures).code, 'navB');
});

test('localizeFailureReason returns localized template when i18n lookup succeeds', () => {
  const lookup = key => ({
    failureReason_target_file_not_active_user: 'Cannot write {file}; active is {activeFile}.',
    failureReason_target_file_not_active_next: 'Open {file} and retry.'
  })[key];
  const localized = localizeFailureReason({
    code: 'target_file_not_active',
    stage: 'navigation',
    severity: 'blocked',
    userMessage: 'fallback msg',
    nextAction: 'fallback next',
    retryable: true,
    file: 'a.tex',
    activeFile: 'b.tex'
  }, 'en', lookup);
  assert.equal(localized.userMessage, 'Cannot write a.tex; active is b.tex.');
  assert.equal(localized.nextAction, 'Open a.tex and retry.');
});

test('localizeFailureReason falls back to failure.userMessage/nextAction when i18n misses', () => {
  const lookup = () => undefined;
  const localized = localizeFailureReason({
    code: 'unknown_code',
    stage: 'unknown',
    severity: 'error',
    userMessage: 'catalog fallback',
    nextAction: 'catalog next',
    retryable: false
  }, 'en', lookup);
  assert.equal(localized.userMessage, 'catalog fallback');
  assert.equal(localized.nextAction, 'catalog next');
});

test('localizeFailureReason interpolates {file}, {activeFile}, {operationType}', () => {
  const lookup = key => ({
    failureReason_x_user: 'op={operationType} file={file} active={activeFile}'
  })[key];
  const localized = localizeFailureReason({
    code: 'x',
    stage: 'navigation',
    severity: 'blocked',
    userMessage: 'fb',
    retryable: false,
    file: 'main.tex',
    activeFile: 'other.tex',
    operationType: 'edit'
  }, 'en', lookup);
  assert.equal(localized.userMessage, 'op=edit file=main.tex active=other.tex');
});

test('localizeFailureReason interpolates missing fields as empty strings', () => {
  const lookup = key => key === 'failureReason_x_user' ? 'file={file}' : undefined;
  const localized = localizeFailureReason({
    code: 'x',
    stage: 'navigation',
    severity: 'blocked',
    userMessage: 'fb',
    retryable: false
  }, 'en', lookup);
  assert.equal(localized.userMessage, 'file=');
});

test('FAILURE_CODE_CATALOG includes aborted_project_changed', () => {
  const entry = FAILURE_CODE_CATALOG.aborted_project_changed;
  assert.ok(entry);
  assert.equal(entry.stage, 'write');
  assert.equal(entry.severity, 'blocked');
  assert.equal(typeof entry.fallbackUserMessage, 'string');
  assert.equal(typeof entry.fallbackNextAction, 'string');
});

test('FAILURE_CODE_CATALOG includes editor_project_id_unavailable', () => {
  const entry = FAILURE_CODE_CATALOG.editor_project_id_unavailable;
  assert.ok(entry);
  assert.equal(entry.stage, 'write');
  assert.equal(entry.severity, 'blocked');
});

test('validateFailureReason accepts the two new codes with blocked/blocked terminalState', () => {
  for (const code of ['aborted_project_changed', 'editor_project_id_unavailable']) {
    const ok = validateFailureReason({
      code, stage: 'write', severity: 'blocked', userMessage: 'x',
      retryable: true, nextAction: 'y', terminalState: 'blocked'
    });
    assert.equal(ok.ok, true, code + ': ' + JSON.stringify(ok));
  }
});

test('normalizeFailureReason produces the new codes when the emitter supplies the catalog entry', () => {
  const reason = normalizeFailureReason({
    ok: false,
    code: 'aborted_project_changed'
  }, { type: 'edit', path: 'main.tex' });
  assert.equal(reason.code, 'aborted_project_changed');
  assert.equal(reason.stage, 'write');
  assert.equal(reason.severity, 'blocked');
  assert.equal(reason.file, 'main.tex');
});
