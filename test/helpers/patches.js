'use strict';

const assert = require('node:assert/strict');

// Applies an array of writeback patches to `text` and returns the result.
// Patches are applied from highest `from` offset to lowest so earlier offsets
// stay valid. Each patch's `expected` is asserted against the original slice,
// mirroring the page-writeback stale guard.
function applyPatches(text, patches) {
  return patches
    .slice()
    .sort((left, right) => right.from - left.from)
    .reduce((next, patch) => {
      assert.equal(next.slice(patch.from, patch.to), patch.expected);
      return next.slice(0, patch.from) + patch.insert + next.slice(patch.to);
    }, text);
}

module.exports = { applyPatches };
