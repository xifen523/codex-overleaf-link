const fs = require('node:fs');
const path = require('node:path');

const { extractFunction } = require('./extractFunction');

const CONTENT_SCRIPT_PATH = path.join(
  __dirname,
  '..',
  '..',
  'extension',
  'src',
  'content',
  'contentRuntime.js'
);

let cachedSource = null;

/**
 * Returns the full contentRuntime.js source text, read once per process and
 * cached. test/p0ProductExperience.test.js reads this 12k-line file
 * ~22 times today; centralizing the read reduces I/O and removes the
 * `path.join(__dirname, '..', 'extension', 'src', 'content', ...)` ritual
 * from every source-grep test.
 */
function getContentScriptSource() {
  if (cachedSource === null) {
    cachedSource = fs.readFileSync(CONTENT_SCRIPT_PATH, 'utf8');
  }
  return cachedSource;
}

/**
 * Convenience wrapper for the common pattern:
 *   const src = getContentScriptSource();
 *   const body = extractFunction(src, name);
 */
function extractFromContentScript(name) {
  return extractFunction(getContentScriptSource(), name);
}

module.exports = {
  CONTENT_SCRIPT_PATH,
  getContentScriptSource,
  extractFromContentScript
};
