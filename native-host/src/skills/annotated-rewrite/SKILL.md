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

Default to this pattern. Apply whenever the rewrite is longer than a single
short phrase, regardless of whether it's a sentence, a paragraph, an
environment body, or a contiguous block. Use it as often as possible — when
in doubt, use it.

A useful rule of thumb: if the replaced content spans **3 or more sentences or
3 or more lines**, always apply it. For shorter rewrites (1-2 sentences or
1-2 lines), lean toward applying it unless the edit is purely at the
**word level** — correcting a single word, fixing a typo, or adjusting a
short phrase in-place.

The word-level exception is the only case where skipping the annotated format
is clearly appropriate (subject to the structural exceptions in Rule 8). For
non-prose blocks (equations, lists, `\begin{figure}...\end{figure}`, and
similar environments), treat each line as equivalent to a sentence when
evaluating the threshold.

## Edit format

```tex
% [original]
% The proposed method encodes user history as a fixed-length vector,
% then applies a linear projection before computing dot-product scores.
% Training uses binary cross-entropy loss over sampled negatives.
%
% \begin{equation}
%   \hat{y}_{ui} = \mathbf{u}_i^\top \mathbf{v}_j
% \end{equation}

% [revised]
We encode user history with a transformer encoder, producing a
context-aware representation that is projected into the item space.
Training minimises a softmax loss over in-batch negatives.

\begin{equation}
  \hat{y}_{ui} = \mathrm{softmax}(\mathbf{U}\mathbf{V}^\top)_{ij}
\end{equation}
```

## Rules

1. Copy the original lines **verbatim** into the comment block — do not alter them
2. Include every line of the replaced content verbatim with `%` prepended;
   blank lines within the block become `%` empty-comment lines (a line
   containing only `%`). Include `\begin{...}` / `\end{...}` markers only when
   they are part of the replaced content — do not comment out enclosing
   environment markers that are not themselves changing
3. No blank line between `% [original]` and the first commented line
4. One blank line between the last commented line and `% [revised]`; one blank
   line before `% [original]` and after the last line of the replacement (to
   separate the annotated construct from surrounding document text)
5. The new content after `% [revised]` is normal LaTeX (not commented)
6. For multiple non-adjacent replaced blocks, apply the pattern independently
   to each block
7. **Idempotency**: if the content being edited already contains a
   `% [original]` / `% [revised]` block, edit only the active content after
   `% [revised]` — do not re-wrap the existing annotated block or create a new
   outer annotation around it
8. **Structure safety**: only apply this pattern at block-level prose context
   (paragraph or environment body). Do NOT insert `% [original]` / `% [revised]` inside
   macro arguments, table rows, math expressions, `\caption{...}`,
   `\item[...]`, or preamble commands — make minimal direct edits there instead,
   or ask for confirmation before changing structurally sensitive content
