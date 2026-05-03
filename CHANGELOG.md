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

### Validation

- Local test suite: `npm test` passed on 2026-05-03 with 428 tests passing.
- Release smoke test: run `npm run smoke:extension -- --url https://www.overleaf.com/project/<project-id> --profile-dir <logged-in-chrome-profile>` against a real Overleaf project before tagging a public beta.
- GitHub Actions: the `Test` workflow runs `npm test` on pushes to `main` and pull requests.

### Local Data

- Plugin Codex sessions are stored under `~/.codex-overleaf/codex-home`.
- Local project mirrors are stored under `~/.codex-overleaf/projects`.
- These directories can contain mirrored paper text and project assets. Delete `~/.codex-overleaf` to remove plugin-local history and mirrors.

### Known Limitations

- macOS + Chrome/Chromium only.
- Distributed as an unpacked extension; not available on the Chrome Web Store.
- Uses Overleaf page internals rather than an official Overleaf API.
- Browser writeback, save detection, and compile-log capture are best-effort and may need updates if Overleaf changes its editor, project tree, compile, or save-state implementation.
- Windows, Linux, Firefox, and hosted/native-less setups are not supported in this release.
