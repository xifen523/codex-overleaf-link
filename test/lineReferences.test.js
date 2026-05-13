const assert = require('node:assert/strict');
const test = require('node:test');

const {
  isLocalPathLike,
  normalizeReferencePath,
  parseLineReferencesFromText,
  resolveProjectReference,
  sanitizeLocalReferences
} = require('../extension/src/shared/lineReferences');

const projectFiles = [
  { path: 'main.tex', kind: 'text' },
  { path: 'sections/intro.tex', kind: 'text' },
  { path: 'chapters/main.tex', kind: 'text' },
  { path: 'figures/logo.png', kind: 'binary' }
];

function simplifyRefs(refs) {
  return refs.map(({ rawText, displayText, rawPath, line, column, source }) => ({
    rawText,
    displayText,
    rawPath,
    line,
    column,
    source
  }));
}

test('parses supported local line reference spellings from plain text', () => {
  assert.deepEqual(
    simplifyRefs(parseLineReferencesFromText({
      text: 'See main.tex:117, sections/intro.tex:42:7, sections/intro.tex line 42, and sections/intro.tex 第 42 行.',
      mode: 'plain-text-token'
    })),
    [
      {
        rawText: 'main.tex:117',
        displayText: 'main.tex:117',
        rawPath: 'main.tex',
        line: 117,
        column: null,
        source: 'plain-text-token'
      },
      {
        rawText: 'sections/intro.tex:42:7',
        displayText: 'sections/intro.tex:42:7',
        rawPath: 'sections/intro.tex',
        line: 42,
        column: 7,
        source: 'plain-text-token'
      },
      {
        rawText: 'sections/intro.tex line 42',
        displayText: 'sections/intro.tex:42',
        rawPath: 'sections/intro.tex',
        line: 42,
        column: null,
        source: 'plain-text-token'
      },
      {
        rawText: 'sections/intro.tex 第 42 行',
        displayText: 'sections/intro.tex:42',
        rawPath: 'sections/intro.tex',
        line: 42,
        column: null,
        source: 'plain-text-token'
      }
    ]
  );
});

test('parses final colon line suffix without treating Windows drive colon as a line marker', () => {
  assert.deepEqual(
    simplifyRefs(parseLineReferencesFromText({
      text: 'Open C:\\Users\\Alice\\workspace\\main.tex:117 and C:\\Users\\Alice\\workspace\\sections\\intro.tex:42:7',
      mode: 'plain-text-token'
    })),
    [
      {
        rawText: 'C:\\Users\\Alice\\workspace\\main.tex:117',
        displayText: 'C:\\Users\\Alice\\workspace\\main.tex:117',
        rawPath: 'C:\\Users\\Alice\\workspace\\main.tex',
        line: 117,
        column: null,
        source: 'plain-text-token'
      },
      {
        rawText: 'C:\\Users\\Alice\\workspace\\sections\\intro.tex:42:7',
        displayText: 'C:\\Users\\Alice\\workspace\\sections\\intro.tex:42:7',
        rawPath: 'C:\\Users\\Alice\\workspace\\sections\\intro.tex',
        line: 42,
        column: 7,
        source: 'plain-text-token'
      }
    ]
  );
});

test('does not parse ranges, HTTP URLs, or email-like strings as local line references', () => {
  assert.deepEqual(
    parseLineReferencesFromText({
      text: 'Ignore main.tex:10-20, https://example.com/main.tex:42, http://example.com/a.tex:5, and alice@main.tex:8.',
      mode: 'plain-text-token'
    }),
    []
  );
});

test('parses markdown label and target references with source mode preserved', () => {
  assert.deepEqual(
    simplifyRefs(parseLineReferencesFromText({
      text: 'C:\\Users\\Alice\\workspace\\main.tex:12',
      mode: 'markdown-link-label'
    })),
    [
      {
        rawText: 'C:\\Users\\Alice\\workspace\\main.tex:12',
        displayText: 'C:\\Users\\Alice\\workspace\\main.tex:12',
        rawPath: 'C:\\Users\\Alice\\workspace\\main.tex',
        line: 12,
        column: null,
        source: 'markdown-link-label'
      }
    ]
  );

  assert.deepEqual(
    simplifyRefs(parseLineReferencesFromText({
      text: 'file:///Users/Alice/workspace/main.tex:12',
      mode: 'markdown-link-target'
    })),
    [
      {
        rawText: 'file:///Users/Alice/workspace/main.tex:12',
        displayText: 'file:///Users/Alice/workspace/main.tex:12',
        rawPath: 'file:///Users/Alice/workspace/main.tex',
        line: 12,
        column: null,
        source: 'markdown-link-target'
      }
    ]
  );
});

test('normalizes reference paths and detects local path forms', () => {
  assert.equal(normalizeReferencePath('@./sections\\intro.tex'), 'sections/intro.tex');
  assert.equal(normalizeReferencePath('/Users/Alice/workspace/main.tex'), 'Users/Alice/workspace/main.tex');
  assert.equal(isLocalPathLike('/Users/Alice/workspace/main.tex'), true);
  assert.equal(isLocalPathLike('file:///Users/Alice/workspace/main.tex'), true);
  assert.equal(isLocalPathLike('C:\\Users\\Alice\\workspace\\main.tex'), true);
  assert.equal(isLocalPathLike('/Users/Alice/.codex-overleaf/projects/p/workspace/main.tex'), true);
  assert.equal(isLocalPathLike('https://example.com/main.tex'), false);
  assert.equal(isLocalPathLike('main.tex'), false);
});

test('resolves exact text project paths before ambiguous suffix or basename matches', () => {
  assert.equal(
    resolveProjectReference({ rawPath: 'main.tex', projectFiles })?.path,
    'main.tex'
  );
  assert.equal(
    resolveProjectReference({ rawPath: 'intro.tex', projectFiles })?.path,
    'sections/intro.tex'
  );
  assert.equal(
    resolveProjectReference({
      rawPath: 'main.tex',
      projectFiles: [
        { path: 'chapters/main.tex', kind: 'text' },
        { path: 'main.tex', kind: 'text' }
      ]
    })?.path,
    'main.tex'
  );
  assert.equal(
    resolveProjectReference({
      rawPath: 'main.tex',
      projectFiles: [
        { path: 'chapters/main.tex', kind: 'text' },
        { path: 'appendix/main.tex', kind: 'text' }
      ]
    }),
    null
  );
});

test('resolves only safe text paths and accepts normalized local workspace suffixes', () => {
  assert.equal(resolveProjectReference({ rawPath: '../main.tex', projectFiles }), null);
  assert.equal(resolveProjectReference({ rawPath: 'sections/../main.tex', projectFiles }), null);
  assert.equal(resolveProjectReference({ rawPath: 'figures/logo.png', projectFiles }), null);
  assert.equal(
    resolveProjectReference({ rawPath: '@./sections\\intro.tex', projectFiles })?.path,
    'sections/intro.tex'
  );
  assert.equal(
    resolveProjectReference({
      rawPath: '/Users/alice/.codex-overleaf/projects/p/workspace/sections/intro.tex',
      projectFiles
    })?.path,
    'sections/intro.tex'
  );
});

test('sanitizes unresolved local paths in render and persist contexts', () => {
  for (const context of ['render', 'persist']) {
    const sanitized = sanitizeLocalReferences(
      'Missing /Users/alice/workspace/missing.tex:117 file:///Users/alice/workspace/missing.tex:118 C:\\Users\\Alice\\workspace\\missing.tex:119 /Users/alice/.codex-overleaf/projects/p/workspace/missing.tex:120',
      { projectFiles, context }
    );

    assert.equal(sanitized.includes('Users'), false);
    assert.equal(sanitized.includes('workspace'), false);
    assert.equal(sanitized.includes('.codex-overleaf/projects'), false);
    assert.equal(sanitized.includes('file://'), false);
    assert.match(sanitized, /\[local path:117\]/);
    assert.match(sanitized, /\[local path:118\]/);
    assert.match(sanitized, /\[local path:119\]/);
    assert.match(sanitized, /\[local path:120\]/);
  }
});

test('sanitizes markdown local labels while preserving safe HTTPS targets', () => {
  assert.equal(
    sanitizeLocalReferences(
      '[C:\\Users\\Alice\\workspace\\main.tex:12](https://example.com)',
      { projectFiles, context: 'render' }
    ),
    '[main.tex:12](https://example.com)'
  );
});

test('sanitizes markdown local labels and targets when unresolved', () => {
  const sanitized = sanitizeLocalReferences(
    '[C:\\Users\\Alice\\workspace\\missing.tex:12](file:///Users/Alice/workspace/missing.tex:12)',
    { projectFiles, context: 'persist' }
  );

  assert.equal(sanitized.includes('Users'), false);
  assert.equal(sanitized.includes('workspace'), false);
  assert.equal(sanitized.includes('file://'), false);
  assert.match(sanitized, /\[local path:12\]/);
});
