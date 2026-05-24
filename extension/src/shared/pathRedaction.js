(function initPathRedaction(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodexOverleafPathRedaction = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function pathRedactionFactory() {
  'use strict';

  // -------------------------------------------------------------------------
  // Welcome-panel + write-guard v1.3.8 add-on (Fix C / spec §5.6.2).
  //
  // Canonical local-path sanitizer shared between `computeSafeTaskSummary`
  // (sessionState) and the storage-side audit redaction helpers
  // (`sanitizeBareLocalPaths` in storageDb). One regex set, one placeholder
  // shape, one place to broaden coverage when a new path shape shows up.
  //
  // Spec §5.6.2 explicitly directs implementers NOT to hand-roll narrow
  // path regexes inside individual sanitizers — the audit redaction layer
  // already exists for this. This module is the extraction the spec calls
  // for so both layers stay in sync.
  //
  // Coverage required by the task brief:
  //   - /Users/...                       (Unix macOS home)
  //   - /home/...                        (Unix Linux home)
  //   - /private/var/..., /private/...   (macOS firmlinks)
  //   - /tmp/...                         (Unix temp)
  //   - /var/folders/...                 (macOS per-user tmp)
  //   - /Volumes/...                     (macOS mounted volumes)
  //   - /etc/..., /opt/..., /usr/...     (system / opt / usr)
  //   - file:///Users/...                (file URLs)
  //   - C:\Users\bob\foo                 (Windows backslash)
  //   - C:/Users/bob/foo                 (Windows forward-slash)
  //   - \\server\share\foo               (Windows UNC)
  //   - .codex-overleaf/projects/...     (this extension's local workspace)
  //
  // Pattern construction notes:
  //   - The Unix branch uses a non-capturing alternation over the top-level
  //     directory names so a future addition (e.g. /srv/...) is one entry,
  //     not a new regex.
  //   - The UNC branch matches `\\` (or `//`) followed by host + share +
  //     path. We deliberately accept the forward-slash form too because
  //     some tools normalize backslashes to forward slashes when logging.
  //   - The file:// branch matches `file://` followed by either two or
  //     three slashes (RFC + common mis-encoded variants).
  // -------------------------------------------------------------------------

  // Top-level Unix directories that mark an absolute local path. We include
  // the most common ones plus a few opt/usr/etc trees so a stray reference
  // does not leak. Adding a new entry is a one-line change here.
  const UNIX_TOPLEVELS = [
    'Users',
    'home',
    'root',
    'private',
    'var',
    'tmp',
    'Volumes',
    'etc',
    'opt',
    'usr',
    'srv',
    'mnt',
    'media'
  ];

  // Match a path token to its end-of-word boundary. We stop at whitespace,
  // closing paren/bracket (markdown link form), backtick, double-quote, or
  // single-quote so we don't over-consume into surrounding text.
  // Note: trailing punctuation like '.,;!?' is allowed inside the path body
  // because filenames legitimately contain dots; downstream callers strip
  // a trailing sentence punctuation character separately when needed.
  const PATH_BODY = '[^\\s)\\]`"\']+';

  // Build the master pattern. Each branch is a complete absolute-path shape.
  // Order matters for clarity but not correctness — alternation is greedy
  // by default in `|`-separated branches; we still anchor each branch to
  // its distinguishing prefix so they don't overlap.
  const ABSOLUTE_PATH_PATTERN = new RegExp(
    [
      // file:// URLs with two or three slashes after the scheme.
      'file:\\/{2,3}' + PATH_BODY,
      // Windows UNC: \\server\share\path  or //server/share/path
      '(?:\\\\\\\\|\\/\\/)[A-Za-z0-9._-]+(?:[\\\\\\/][A-Za-z0-9._$-]+)+',
      // Windows drive letter: C:\path  or  C:/path
      '[A-Za-z]:[\\\\\\/]' + PATH_BODY,
      // Unix absolute path under a known top-level directory.
      '\\/(?:' + UNIX_TOPLEVELS.join('|') + ')\\/' + PATH_BODY,
      // Local Codex workspace marker — appears with or without a leading
      // slash; e.g.  /home/x/.codex-overleaf/projects/p1 or  ./.codex-
      // overleaf/projects/p1. The Unix branch above already handles the
      // common /home form; this branch catches the relative form.
      '(?:^|[\\s\\\\/])\\.codex-overleaf[\\\\\\/]projects[\\\\\\/]' + PATH_BODY
    ].join('|'),
    'gi'
  );

  // Quick predicate — used by callers that only want to do the (more
  // expensive) substitution pass when there's actually something to strip.
  const MIGHT_CONTAIN_LOCAL_PATH_PATTERN = new RegExp(
    [
      'file:\\/{2,3}',
      '(?:\\\\\\\\|\\/\\/)[A-Za-z0-9._-]+[\\\\\\/]',
      '[A-Za-z]:[\\\\\\/]',
      '\\/(?:' + UNIX_TOPLEVELS.join('|') + ')\\/',
      '\\.codex-overleaf[\\\\\\/]projects[\\\\\\/]'
    ].join('|'),
    'i'
  );

  // Replace every absolute-local-path token in `value` with `placeholder`.
  // Default placeholder is `<local-path>` to match the prior summary-side
  // sanitizer. The storage-side audit redactor uses a richer `[local path]`
  // (and `[local path:LINE]` when a `:line` suffix was present); that path
  // continues to use its own formatter — this helper is the floor, not
  // the only formatter.
  function redactLocalPaths(value, placeholder) {
    if (typeof value !== 'string' || !value) {
      return '';
    }
    const token = typeof placeholder === 'string' ? placeholder : '<local-path>';
    // Reset state (these are /g regexes) before reusing.
    ABSOLUTE_PATH_PATTERN.lastIndex = 0;
    return value.replace(ABSOLUTE_PATH_PATTERN, token);
  }

  function mightContainLocalPath(value) {
    if (typeof value !== 'string' || !value) {
      return false;
    }
    return MIGHT_CONTAIN_LOCAL_PATH_PATTERN.test(value);
  }

  return {
    redactLocalPaths,
    mightContainLocalPath,
    // Exposed so the storage-side audit redactor (which formats per-token
    // placeholders with line-suffix preservation) can iterate the same set
    // without duplicating the regex source.
    ABSOLUTE_PATH_PATTERN,
    UNIX_TOPLEVELS
  };
});
