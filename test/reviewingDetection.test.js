const assert = require('node:assert/strict');
const test = require('node:test');

const { detectReviewingFromSignals } = require('../extension/src/shared/reviewing');

test('detects Reviewing from Overleaf toolbar button text when body text is incomplete', () => {
  const result = detectReviewingFromSignals({
    bodyText: 'File tree Code Editor Visual Editor Recompile',
    controls: [
      { text: 'Recompile' },
      { text: 'Reviewing' }
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'detected');
  assert.equal(result.source, 'control-text');
});

test('detects enabled track changes from labels and titles', () => {
  const result = detectReviewingFromSignals({
    bodyText: '',
    controls: [
      { ariaLabel: 'Track Changes on', title: '' }
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.source, 'control-text');
});

test('detects Reviewing from richer DOM attributes collected on Overleaf', () => {
  const result = detectReviewingFromSignals({
    bodyText: '',
    controls: [
      {
        className: 'toolbar-reviewing-button',
        htmlSnippet: '<button><span>Reviewing</span></button>'
      }
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.source, 'control-text');
});

test('does not treat a generic review panel tab as active Reviewing mode', () => {
  const result = detectReviewingFromSignals({
    bodyText: 'Review panel Chat File tree',
    controls: [
      { text: 'Review panel' }
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'not-detected');
});

test('does not treat hidden Reviewing menu text as active Reviewing mode', () => {
  const result = detectReviewingFromSignals({
    bodyText: 'Editing Source Rich Text Reviewing Track Changes',
    controls: []
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'not-detected');
});

test('does not treat false internal reviewing flags as active Reviewing mode', () => {
  const result = detectReviewingFromSignals({
    bodyText: '',
    controls: [],
    internalStates: [
      'reviewing:false',
      'trackChanges:false'
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'not-detected');
});

test('manual override is explicit and auditable', () => {
  const result = detectReviewingFromSignals({
    manualOverride: true,
    bodyText: '',
    controls: []
  });

  assert.deepEqual(result, {
    ok: true,
    status: 'manual-override',
    source: 'user-confirmed'
  });
});
