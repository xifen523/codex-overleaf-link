const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('reviewing safety toggle has a clear hover tooltip', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const i18n = fs.readFileSync(
    path.join(__dirname, '../extension/src/shared/i18n.js'),
    'utf8'
  );

  assert.match(contentScript, /codex-review-toggle[^>]+title="When enabled, Codex checks or switches Overleaf Reviewing\/Track Changes before writing\. Deletes still require confirmation\."/);
  assert.match(contentScript, /codex-review-label" data-i18n="requireReviewing">Track</);
  assert.match(i18n, /requireReviewingTitle:\s*'开启后，写入前会确认并尝试切到 Overleaf Reviewing\/Track Changes；删除仍需确认。'/);
});
