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

test('parses adjacent comma and CJK punctuation separated line references', () => {
  assert.deepEqual(
    simplifyRefs(parseLineReferencesFromText({
      text: '对应位置包括 camera_ready.tex:169、camera_ready.tex:225，camera_ready.tex:248;camera_ready.tex:252,camera_ready.tex:270。',
      mode: 'plain-text-token'
    })),
    [
      {
        rawText: 'camera_ready.tex:169',
        displayText: 'camera_ready.tex:169',
        rawPath: 'camera_ready.tex',
        line: 169,
        column: null,
        source: 'plain-text-token'
      },
      {
        rawText: 'camera_ready.tex:225',
        displayText: 'camera_ready.tex:225',
        rawPath: 'camera_ready.tex',
        line: 225,
        column: null,
        source: 'plain-text-token'
      },
      {
        rawText: 'camera_ready.tex:248',
        displayText: 'camera_ready.tex:248',
        rawPath: 'camera_ready.tex',
        line: 248,
        column: null,
        source: 'plain-text-token'
      },
      {
        rawText: 'camera_ready.tex:252',
        displayText: 'camera_ready.tex:252',
        rawPath: 'camera_ready.tex',
        line: 252,
        column: null,
        source: 'plain-text-token'
      },
      {
        rawText: 'camera_ready.tex:270',
        displayText: 'camera_ready.tex:270',
        rawPath: 'camera_ready.tex',
        line: 270,
        column: null,
        source: 'plain-text-token'
      }
    ]
  );
});

test('parses fullwidth colon separated line references without confusing it with the ASCII line-number colon', () => {
  assert.deepEqual(
    simplifyRefs(parseLineReferencesFromText({
      text: 'changes：camera_ready.tex:42！camera_ready.tex:99？camera_ready.tex:7',
      mode: 'plain-text-token'
    })),
    [
      {
        rawText: 'camera_ready.tex:42',
        displayText: 'camera_ready.tex:42',
        rawPath: 'camera_ready.tex',
        line: 42,
        column: null,
        source: 'plain-text-token'
      },
      {
        rawText: 'camera_ready.tex:99',
        displayText: 'camera_ready.tex:99',
        rawPath: 'camera_ready.tex',
        line: 99,
        column: null,
        source: 'plain-text-token'
      },
      {
        rawText: 'camera_ready.tex:7',
        displayText: 'camera_ready.tex:7',
        rawPath: 'camera_ready.tex',
        line: 7,
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

test('parses markdown file targets with spaces, parentheses, query, and hash suffixes', () => {
  assert.deepEqual(
    simplifyRefs(parseLineReferencesFromText({
      text: 'file:///Users/Alice/path with space/(paper)/main.tex:12#L12',
      mode: 'markdown-link-target'
    })),
    [
      {
        rawText: 'file:///Users/Alice/path with space/(paper)/main.tex:12#L12',
        displayText: 'file:///Users/Alice/path with space/(paper)/main.tex:12#L12',
        rawPath: 'file:///Users/Alice/path with space/(paper)/main.tex',
        line: 12,
        column: null,
        source: 'markdown-link-target'
      }
    ]
  );

  assert.equal(
    resolveProjectReference({
      rawPath: 'file:///Users/Alice/path%20with%20space/(paper)/main.tex',
      projectFiles
    })?.path,
    'main.tex'
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

test('redacts the full canonical Unix top-level set, not just Users/home/private/var/tmp', () => {
  // v1.4.1: BARE_LOCAL_PATH_PATTERN widened to the canonical pathRedaction.js
  // UNIX_TOPLEVELS, so paths under /opt /etc /root /Volumes /usr /srv /mnt
  // /media no longer leak through the highest-exposure (live + persist) layer.
  for (const context of ['render', 'persist']) {
    const sanitized = sanitizeLocalReferences(
      'a /opt/acme/secret.tex:1 b /etc/passwd c /root/keys.tex:2 d /Volumes/Disk/paper.tex:3 e /usr/share/x.tex:4 f /srv/data/y.tex:5 g /mnt/vol/z.tex:6 h /media/usb/w.tex:7',
      { projectFiles, context }
    );
    for (const leak of ['/opt/acme', '/etc/passwd', '/root/keys', '/Volumes/Disk', '/usr/share', '/srv/data', '/mnt/vol', '/media/usb']) {
      assert.equal(sanitized.includes(leak), false, `${leak} should be redacted`);
    }
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

test('sanitizes markdown file targets with balanced parentheses when resolved', () => {
  assert.equal(
    sanitizeLocalReferences(
      '[source](file:///Users/Alice/path with space/(paper)/main.tex:12)',
      { projectFiles, context: 'render' }
    ),
    '[source]'
  );
});

test('fails closed for malformed or undecodable local markdown targets', () => {
  for (const value of [
    '[source](file:///Users/Alice/(paper/main.tex:12',
    '[source](file:///Users/Alice/%E0%A4%A/main.tex:12)',
    '[source](file:///C:/Users/Alice/workspace/missing.tex:12?token=secret)'
  ]) {
    const sanitized = sanitizeLocalReferences(value, { projectFiles, context: 'render' });
    assert.equal(/Users|workspace|file:|secret/.test(sanitized), false);
  }
});
