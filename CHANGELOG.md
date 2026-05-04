# Changelog

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
