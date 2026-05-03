# Changelog

All notable changes to Codex Overleaf Link are documented here.

## [0.1.0] - 2026-05-03

### Added

- Chrome extension panel for running local Codex from Overleaf project pages.
- macOS Native Messaging host for launching Codex against a local project mirror.
- Per-project local workspace mirrors under `~/.codex-overleaf/projects`.
- Plugin-isolated Codex home under `~/.codex-overleaf/codex-home`.
- Ask-only, suggest-edit, and auto-write workflows.
- Live Codex progress stream in the Overleaf panel.
- Per-file diff review and guarded browser writeback.
- Reviewing/Track Changes preflight and stale-write checks before applying edits.
- Local undo checkpoints for reversible writeback.
- Binary project asset mirroring for local LaTeX context.
- Optional Overleaf recompile trigger and compile-log context.

### Known Limitations

- macOS + Chrome/Chromium only.
- Distributed as an unpacked extension; not available on the Chrome Web Store.
- Uses Overleaf page internals rather than an official Overleaf API.
- Browser writeback may need updates if Overleaf changes its editor or project tree implementation.
- Windows, Linux, Firefox, and hosted/native-less setups are not supported in this release.
