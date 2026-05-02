const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('reviewing safety toggle has a clear hover tooltip', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );

  assert.match(contentScript, /codex-review-toggle[^>]+title="开启后，写入前会要求 Overleaf 留痕\/Reviewing 可用；删除仍需确认。"/);
  assert.match(contentScript, /codex-review-label">留痕</);
});
