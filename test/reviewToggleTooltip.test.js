const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('reviewing safety toggle has a clear hover tooltip', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );

  assert.match(contentScript, /codex-review-toggle[^>]+title="要求 Reviewing\/Track Changes，验证失败时阻止写入"/);
});
