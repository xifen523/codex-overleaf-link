# Changelog

## v0.7.0 - 2026-05-06

Project personalization release. This version adds project-scoped custom instructions that are injected into Codex runs while keeping the v0.6 hunk review workflow intact.

### Added

- A settings entry in the panel header for project-scoped custom instructions.
- A personalization settings view with a large custom instruction editor and saved per-project storage.
- Native run prompt injection so saved custom instructions are included as additional Codex context for the active Overleaf project.

### Changed

- Bumped package, extension, and native compatibility metadata to `0.7.0`.
- Updated install, update, README badge, native mismatch recovery command, and release artifact references for `v0.7.0`.

### Fixed

- Native Codex runs now preserve recoverable thread resume failures so the panel can surface session recovery issues instead of flattening them into generic failures.

### Notes

- Native protocol remains `1`; this release uses a version compatibility bump because the extension and native host both participate in custom instruction delivery.
- Custom instructions are user-defined project preferences stored locally by project id and injected only for that project's runs.

## v0.6.0 - 2026-05-06

Editor-native review UX release. This version adds hunk-level review controls and editor jump support while preserving the v0.5 cross-platform native host packaging and guarded browser writeback model.

### Added

- Hunk-level diff review metadata and panel controls for accepting, rejecting, and jumping to individual text edits.
- Editor jump plumbing for review hunks, with large-diff rendering safeguards and scoped keyboard review shortcuts.

### Changed

- Review decisions now collapse completed hunks and advance focus to the next pending hunk for faster keyboard and button review.
- Bulk accept/reject actions now fill only pending hunks while preserving manual hunk choices, including file-level hunk actions.
- Bumped package and extension metadata to `0.6.0`.
- Updated install, update, README badge, and release artifact references for `v0.6.0`.
- Release verification now derives the required release reference from `package.json` instead of a stale fixed v0.5 value.
- Release workflow now fails early when the pushed tag does not match the package version.
- Chrome Web Store preparation copy now reflects macOS, Windows, and Linux native host support.

### Fixed

- Patch-backed review hunks now render their own diff text when a display diff has fewer hunks than the underlying text patches, preventing later hunks from appearing blank.
- Truncated or unsafe hunk mappings fall back to file-level review instead of exposing misleading per-hunk choices.

### Notes

- Native protocol remains `1`; this release does not require a protocol bump.
- The v0.5 macOS / Windows / Linux packaging and installer notes remain historically intact below.

## v0.5.0 - 2026-05-06

Cross-platform native host release. This version extends the native installer, runtime paths, and release packaging beyond the original macOS-only preview while preserving the v0.4 user workflow and release safeguards.

### Added

- Windows Native Messaging host installation through `install.ps1`, including user-level Chrome registry registration and `.cmd` bridge launch support.
- Linux Chrome and Chromium Native Messaging host manifest paths under the user's config directory.
- Release artifacts for the v0.5.0 extension package, native host runtime, macOS / Linux installer, Windows PowerShell installer, uninstaller, checksums, and release manifest.
- Cross-platform CI coverage for macOS, Ubuntu, and Windows, with release publishing gated by the test matrix.

### Changed

- Bumped package and extension metadata to `0.5.0`.
- Updated install, update, release artifact, and uninstall documentation for macOS, Windows, and Linux.
- Replaced macOS-only platform requirements with macOS / Windows / Linux support guidance.

### Notes

- Release publishing remains tag-based and uploads artifacts from a single release job after the matrix passes.
- Chrome still requires manual unpacked-extension approval after the native host installer finishes.

## v0.4.0 - 2026-05-06

Distribution and update foundation release. This version keeps the v0.3 sync and writeback behavior intact while adding compatibility diagnostics, release artifacts, installer update guidance, and Chrome Web Store preparation material.

### Added

- Compatibility diagnostics for missing, old, future, protocol-incompatible, or unhealthy native hosts.
- Native request gates that block execution and mirror mutation when the installed native host is not compatible with the extension.
- Reproducible GitHub Release artifact generation for the Chrome extension package, native host runtime, installer scripts, checksums, and release manifest.
- Chrome Web Store preparation docs for permissions, privacy posture, listing copy, and the pre-submission release checklist.

### Changed

- Bumped package and extension metadata to `0.4.0`.
- Documented the v0.4.0 version-pinned installer command as the canonical update and native mismatch recovery path.
- Improved installer output with source ref, checked-out package version, extension path, native host paths, and reload/refresh next steps.

### Fixed

- Browser writeback now waits for the target file's editor document to finish loading after file-tree navigation before running stale guards or applying patches, preventing false stale conflicts during multi-file writes.

### Notes

- Actual Chrome Web Store submission is outside v0.4.
- Automatic native host updates are not included; updates remain explicit and user-driven.
- The experimental OT warm mirror remains off by default and continues to fall back to full snapshots.

## v0.3.0 - 2026-05-06

Experimental OT warm mirror release. This version focuses on reducing startup sync work for focused-file tasks while keeping the normal full snapshot path as the safe source of truth.

### Added

- Experimental read-only OT warm mirror for focused Overleaf editor changes.
- Active-editor observation for known text files, with verified native `mirror.patchFiles` updates to the local mirror.
- Per-file OT freshness metadata in mirror status, used only when focused files are fresh and covered.
- OT diagnostics showing status, fresh files, fallback state, and safe next steps without exposing project content.
- Project-scoped experimental OT preference persisted separately per Overleaf project.

### Changed

- Moved the experimental OT control out of the composer toolbar and into the diagnostics menu with a first-use confirmation prompt.
- Added lightweight `OT Live` status to the probe footer only when the experimental mirror is enabled.
- Shortened the composer compile toggle to `Compile` and made Track/Compile visual states self-contained.
- Reworked the composer toolbar layout so Track, Compile, model selection, and Send stay in stable columns.
- Kept English and Chinese UI strings locale-specific instead of mixing both languages in one control.

### Fixed

- Fixed the experimental OT toggle so it gives visible feedback, can be clicked from the diagnostics menu, and does not appear as a dead `Off` label.
- Fixed model picker alignment in the bottom toolbar after adding the Compile/Track pills.
- Preserved fallback to normal project reads whenever OT is unavailable, stale, inconsistent, or missing focused-file coverage.

### Notes

- OT warm mirror is off by default.
- Full snapshot sync remains the project-level source of truth and fallback.
- OT warm mirror is read-only with respect to Overleaf realtime channels; browser writeback still uses the existing guarded write path.
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
