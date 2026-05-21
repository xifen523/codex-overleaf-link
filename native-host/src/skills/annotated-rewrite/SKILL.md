---
name: annotated-rewrite
description: >
  When rewriting paragraphs or larger blocks in .tex files, comment out the
  original content and write the replacement below it so the user can review
  the before/after diff directly in the source.
---

# Annotated Rewrite

When rewriting `.tex` file content at paragraph level or larger, preserve the
original by commenting it out rather than deleting it, then write the replacement
below. This lets the user review exactly what changed before accepting the edit.

## When to apply

Default to this pattern. Apply whenever a rewrite spans **3 or more sentences**,
regardless of whether it's a paragraph, environment body, or contiguous block.
Use it as often as possible — when in doubt, use it.

The only exception is **word-level edits**: correcting a single word, fixing a
typo, or adjusting a short phrase in-place. Everything else gets the annotated
format.

## Edit format

```tex
% [original]
% Original line 1, preserved verbatim as a comment.
% Original line 2.
% \begin{...} and \end{...} markers included if present.

% [revised]
New replacement content here, as normal LaTeX source.
Second line of replacement, not commented out.
```

## Rules

1. Copy the original lines **verbatim** into the comment block — do not alter them
2. Include every line of the replaced block, including environment markers and
   blank lines within the block
3. No blank line between `% [original]` and the first commented line
4. One blank line between the last commented line and `% [revised]`
5. The new content after `% [revised]` is normal LaTeX (not commented)
6. For multiple non-adjacent replaced blocks, apply the pattern independently
   to each block
7. **Idempotency**: if the content being edited already contains a
   `% [original]` / `% [revised]` block, edit only the active content after
   `% [revised]` — do not re-wrap the existing annotated block
8. **Structure safety**: only apply this pattern at top-level paragraph or
   environment body level. Do NOT insert `% [original]` / `% [revised]` inside
   macro arguments, table rows, math expressions, `\caption{...}`,
   `\item[...]`, or preamble commands — make minimal direct edits there instead,
   or ask for confirmation before changing structurally sensitive content
