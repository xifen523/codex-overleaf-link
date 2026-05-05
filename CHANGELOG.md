# Changelog

## v0.3.0 - 2026-05-05

### Added

- Experimental read-only OT warm mirror toggle.
- Active-editor observation for known text files.
- Native `mirror.patchFiles` endpoint for verified per-file mirror patches.
- Per-file OT freshness metadata in mirror status.
- OT diagnostics with fallback state and no project content.

### Notes

- OT warm mirror is off by default.
- Full snapshot sync remains the project-level source of truth.
- Browser writeback, stale guards, verified save gates, and undo remain unchanged.

## v0.2.0 - 2026-05-05

Reliability and daily-use update for the macOS + Chrome preview.

### Added

- Native host reconnect handling for safe read and mirror sync requests without silently rerunning active Codex tasks.
- Dynamic Codex model discovery through the native host, with fallback to the v0.1.1 model list when local discovery is unavailable.
- Non-invasive mirror prefetch and warm-start reuse so recent local workspaces can reduce task startup wait without switching Overleaf files.
- Mirror status metadata for freshness, dirty state, project key, file count, and sync timestamps.
- Compact model configuration UI for model, reasoning effort, and speed tier.

### Fixed

- Added a verified Overleaf save-state gate before refreshing the mirror baseline after browser writeback.
- Hardened warm mirror fallback, stale mirror retry, partial snapshot boundaries, and dirty workspace detection.
- Required Editing mode for untracked browser writes and preserved Reviewing requirements per submitted run.
- Improved post-write compile handling when Overleaf save state is unavailable or unverified.
- Kept plugin session deletion feedback out of the task transcript and below the task list.

## v0.1.1 - 2026-05-04

Security and reliability hotfix for the initial stable preview.

### Fixed

- Removed the legacy shell-command external agent path; the native host now launches the bundled agent with an explicit executable and argument list.
- Restricted background native-host requests to Overleaf project pages.
- Added same-origin checks to page-bridge messages.
- Avoid replaying stale Overleaf compile request templates.
- Tightened plugin Codex home permissions for copied auth state.
- Prevented ambiguous native framing errors from being applied to unrelated pending requests.
- Prevented user-facing task diagnostics from exposing raw stack traces.
- Hardened markdown links and session-list rendering in the panel.

## v0.1.0 - 2026-05-04

Initial stable preview for using Codex from inside Overleaf.

### Added

- Chrome side panel for running Codex directly in Overleaf projects.
- Native host bridge that uses the user's local Codex CLI account.
- Per-project local mirror workspaces under `~/.codex-overleaf/projects`.
- Plugin-isolated Codex history under `~/.codex-overleaf/codex-home`.
- Full-project snapshot sync with binary asset mirroring for LaTeX checks.
- File-focused context picker with Overleaf folder hierarchy.
- Ask, suggest, and auto-write task modes.
- Optional Overleaf Reviewing / Track Changes guard for write tasks.
- Diff review, stale-write protection, and undo checkpoints.
- Auto-recompile integration and `@compile-log` context support.
- English and Chinese UI language toggle.
- One-command macOS installer and native host uninstall command.

### Notes

- This release targets macOS and Chrome with an unpacked extension install.
- Overleaf writeback and compile detection depend on Overleaf page internals and may need updates if Overleaf changes its frontend.
- The bridge runs locally, but Codex processing uses the user's configured Codex CLI account.
