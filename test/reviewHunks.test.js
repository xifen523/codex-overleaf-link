const assert = require('node:assert/strict');
const test = require('node:test');

const ReviewHunks = require('../extension/src/content/reviewHunks');

test('buildReviewModel creates one review hunk per text patch', () => {
  const model = ReviewHunks.buildReviewModel([
    {
      type: 'write',
      path: 'main.tex',
      diff: [{ startA: 1, startB: 1, lines: [] }],
      patches: [
        { from: 0, to: 5, expected: 'alpha', insert: 'ALPHA' },
        { from: 20, to: 24, expected: 'beta', insert: 'BETA' }
      ]
    }
  ]);

  assert.equal(model.files[0].hunks.length, 2);
  assert.equal(model.files[0].hunks[0].id, 'main.tex:hunk:0');
  assert.deepEqual(model.files[0].hunks[0].patchIndexes, [0]);
  assert.deepEqual(model.files[0].hunks[1].patchIndexes, [1]);
});

test('buildAcceptedSyncChanges filters accepted hunk patch indexes without replaceAll', () => {
  const syncChanges = [
    {
      type: 'write',
      path: 'main.tex',
      content: 'ignored full content',
      patches: [
        { from: 0, to: 5, expected: 'alpha', insert: 'ALPHA' },
        { from: 20, to: 24, expected: 'beta', insert: 'BETA' }
      ]
    }
  ];
  const model = ReviewHunks.buildReviewModel(syncChanges);
  const accepted = ReviewHunks.buildAcceptedSyncChanges(syncChanges, {
    [ReviewHunks.normalizeReviewDecisionKey('main.tex', model.files[0].hunks[1].id)]: 'accepted'
  });

  assert.equal(accepted.length, 1);
  assert.deepEqual(accepted[0].patches, [
    { from: 20, to: 24, expected: 'beta', insert: 'BETA' }
  ]);
  assert.equal(Object.hasOwn(accepted[0], 'replaceAll'), false);
  assert.equal(syncChanges[0].patches.length, 2);
});

test('file-level changes without reviewable hunks use file decision keys', () => {
  const syncChanges = [
    { type: 'create', path: 'new.tex', content: 'new' },
    { type: 'delete', path: 'old.tex' }
  ];
  const model = ReviewHunks.buildReviewModel(syncChanges);
  const summary = ReviewHunks.summarizeReviewModel(model);

  assert.equal(model.files[0].hunks.length, 0);
  assert.equal(model.files[0].decisionKey, ReviewHunks.normalizeReviewDecisionKey('new.tex'));
  assert.equal(model.files[1].decisionKey, ReviewHunks.normalizeReviewDecisionKey('old.tex'));
  assert.equal(summary.files, 2);
  assert.equal(summary.hunks, 0);
  assert.equal(summary.fallbackFiles, 2);

  const accepted = ReviewHunks.buildAcceptedSyncChanges(syncChanges, {
    [model.files[0].decisionKey]: 'accepted',
    [model.files[1].decisionKey]: 'rejected'
  });

  assert.deepEqual(accepted, [
    { type: 'create', path: 'new.tex', content: 'new' }
  ]);
});

test('truncated display diffs with valid patches remain hunk-reviewable', () => {
  const syncChanges = [
    {
      type: 'write',
      path: 'large.tex',
      diff: [{ truncated: true, lines: [{ type: 'context', text: 'large diff' }] }],
      patches: [
        { from: 0, to: 5, expected: 'alpha', insert: 'ALPHA' },
        { from: 20, to: 24, expected: 'beta', insert: 'BETA' }
      ]
    }
  ];
  const model = ReviewHunks.buildReviewModel(syncChanges);
  const accepted = ReviewHunks.buildAcceptedSyncChanges(syncChanges, {
    [ReviewHunks.normalizeReviewDecisionKey('large.tex', 'large.tex:hunk:1')]: 'accepted'
  });

  assert.equal(model.files[0].reviewable, true);
  assert.equal(model.files[0].hunks.length, 2);
  assert.equal(model.files[0].hunks[0].id, 'large.tex:hunk:0');
  assert.deepEqual(accepted[0].patches, [
    { from: 20, to: 24, expected: 'beta', insert: 'BETA' }
  ]);
});

test('invalid patched writes fall back to file-level decisions', () => {
  const syncChanges = [
    {
      type: 'write',
      path: 'invalid.tex',
      patches: [
        { from: 5, to: 1, expected: 'bad', insert: 'BAD' }
      ]
    }
  ];
  const model = ReviewHunks.buildReviewModel(syncChanges);
  const accepted = ReviewHunks.buildAcceptedSyncChanges(syncChanges, {
    [model.files[0].decisionKey]: 'accepted'
  });

  assert.equal(model.files[0].hunks.length, 0);
  assert.equal(model.files[0].reviewable, false);
  assert.deepEqual(accepted, [syncChanges[0]]);
  assert.notEqual(accepted[0], syncChanges[0]);
});
