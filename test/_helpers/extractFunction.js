const assert = require('node:assert/strict');

/**
 * Extract a single named function (sync or async) from a JS source string and
 * return its complete declaration text. Used by source-grep tests that want to
 * load just the named function into a `new Function(...)` sandbox or assert
 * structural properties of its body.
 *
 * Walks the parenthesized signature with paren-depth tracking BEFORE searching
 * for the opening body brace, so default-value braces in the signature don't
 * fool the body-brace search. Without that, `function foo(input = {}) { ... }`
 * stops the extractor at the default-value `{}` and returns only the signature
 * — a class of bug that bit the v1.3.8 work three times before this helper
 * was consolidated.
 *
 * Known limitations (acceptable for this codebase):
 * - Does not parse string literals, regex literals, or comments inside the
 *   parameter list. `function foo(x = ')'` would confuse it. Such
 *   signatures don't currently exist anywhere under extension/ or native-host/.
 * - Does not handle arrow-function declarations (`const foo = (x) => {…}`).
 *   Callers that need those should pre-rewrite or skip.
 */
function extractFunction(source, name) {
  const markers = [`function ${name}(`, `async function ${name}(`];
  const start = markers
    .map(marker => source.indexOf(marker))
    .filter(index => index !== -1)
    .sort((a, b) => a - b)[0] ?? -1;
  assert.notEqual(start, -1, `${name} should exist`);

  // Walk past the parenthesized signature so default-value braces like
  // `function foo(input = {})` don't fool the body-brace search below.
  const parenStart = source.indexOf('(', start);
  assert.notEqual(parenStart, -1, `${name} should have a parameter list`);
  let parenDepth = 0;
  let signatureEnd = -1;
  for (let i = parenStart; i < source.length; i++) {
    if (source[i] === '(') {
      parenDepth++;
    } else if (source[i] === ')') {
      parenDepth--;
      if (parenDepth === 0) {
        signatureEnd = i;
        break;
      }
    }
  }
  assert.notEqual(signatureEnd, -1, `${name} signature should close`);

  const openBrace = source.indexOf('{', signatureEnd);
  assert.notEqual(openBrace, -1, `${name} should have a body`);
  let depth = 0;
  for (let index = openBrace; index < source.length; index++) {
    if (source[index] === '{') {
      depth++;
    } else if (source[index] === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  assert.fail(`${name} body should close`);
  return ''; // unreachable, but satisfies the type-checker / linter
}

module.exports = { extractFunction };
