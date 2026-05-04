const assert = require('node:assert/strict');
const test = require('node:test');

const MirrorHealth = require('../extension/src/content/mirrorHealth');

test('classifies mirror freshness at boundaries', () => {
  assert.equal(MirrorHealth.classifyMirrorHealth({ exists: false }).state, 'missing');
  assert.equal(MirrorHealth.classifyMirrorHealth({ exists: true, ageMs: 10_000 }).state, 'fresh');
  assert.equal(MirrorHealth.classifyMirrorHealth({ exists: true, ageMs: MirrorHealth.MIRROR_FRESH_LABEL_MS + 1 }).state, 'stale');
  assert.equal(MirrorHealth.classifyMirrorHealth({ exists: true, ageMs: MirrorHealth.MIRROR_STALE_LABEL_MS + 1 }).state, 'stale');
});

test('prefetch state skips while busy or cooling down', () => {
  assert.equal(MirrorHealth.shouldStartPrefetch({ busy: true }).ok, false);
  assert.equal(MirrorHealth.shouldStartPrefetch({ inFlight: Promise.resolve() }).ok, false);
  assert.equal(MirrorHealth.shouldStartPrefetch({ now: 10_000, lastSuccessAt: 9_000 }).ok, false);
  assert.equal(MirrorHealth.shouldStartPrefetch({ now: 60_000, lastSuccessAt: 0 }).ok, true);
});
