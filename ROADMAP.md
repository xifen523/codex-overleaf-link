# Roadmap to v1.0

This roadmap describes the production-stable `v1.0.0` release line and the historical path that led to it. The `v0.1` through `v0.9.5` sections are retained as historical milestones.

The guiding principle is simple: make the existing bridge reliable first, then improve synchronization, then broaden distribution and platform support. Features that increase sync complexity or security surface area should stay behind explicit opt-in flags until they are proven stable.

## Release Discipline

- `main` tracks release-candidate hardening, stable releases, and release hotfixes.
- `next` tracks post-`v1.0.0` development toward the next planned release.
- `v0.9.x` was the release-candidate hardening line: P0/P1 fixes, architecture hardening, release gate corrections, documentation corrections, manual smoke signoff, and compatibility signoff.
- Historical `v0.1.x` releases were the original hotfix-only stable preview line and are no longer the current release line.
- Experimental sync features must preserve the current full-snapshot fallback path.
- User project content must stay local to the bridge and the user's configured Codex CLI account. The project should not add a hosted backend.

## v0.1.x: Stable Hotfix Line

**Goal:** Keep the current macOS + Chrome release usable while larger work happens on `next`.

### Scope

- Installer fixes.
- Native host compatibility fixes.
- Overleaf writeback, undo, language, session, context picker, and compile-log bug fixes.
- Security or privacy fixes.

### Acceptance Criteria

- Hotfixes do not introduce new product surface area.
- `npm test` passes before each release.
- The release notes clearly describe the fixed user-facing issue.

## v0.2.0: Reliability and Daily UX

**Goal:** Make daily use smooth for current macOS + Chrome users.

### Planned Work

- Native host auto-reconnect after crashes, stale ports, or transient native messaging failures.
- Save-state verification after browser writeback, before compile or mirror-baseline refresh.
- Non-invasive mirror prefetch:
  - deferred cold start after page load,
  - intent prefetch while the user is typing a task,
  - no automatic file-tree navigation,
  - no editor focus disruption.
- Mirror health indicators: last full sync, current project id, snapshot source, and recent errors.
- Better recovery for mirror sync failures, network interruption, and partial Overleaf snapshots.
- User-facing diagnostics that explain the next action without raw internal state.

### Non-Goals

- No OT/WebSocket dependency.
- No automatic polling that opens or switches Overleaf files.
- No change to the stable writeback architecture.

### Acceptance Criteria

- Sending a task after a recent mirror prefetch avoids a full visible wait when the mirror is fresh.
- The Overleaf file tree and active editor do not change because of background sync.
- Recompile is triggered only after the extension can verify that Overleaf has saved the written content, or the result is marked as unverified.
- A native host restart does not require refreshing the Overleaf page in common failure cases.

## v0.3.0: Experimental OT Warm Mirror

**Goal:** Test Overleaf real-time change events as a read-only acceleration layer.

### Planned Work

- Detect and observe Overleaf's real-time collaboration channel where available.
- Parse text document deltas into local mirror updates.
- Add a native `mirror.patchFiles` API for incremental file updates.
- Track per-file freshness separately from full-project freshness.
- Fall back to the full snapshot path when OT observation is unavailable, stale, or inconsistent.
- Add a user-visible experimental toggle and diagnostics for OT status.

### Non-Goals

- Do not write back to Overleaf through OT.
- Do not remove ZIP/full-snapshot sync.
- Do not treat OT as the only source of truth for whole-project tasks.

### Acceptance Criteria

- If OT is unavailable, current `v0.2` behavior still works.
- If OT is available, edits to observed text files update the local mirror without switching the Overleaf editor.
- Whole-project runs still perform or validate against a full snapshot unless the mirror has a verified project-level freshness signal.

## v0.4.0: Distribution and Update Foundation

**Goal:** Reduce installation and update friction before broad platform work.

### Planned Work

- Extension-to-native protocol version handshake.
- Clear UI when the extension and native host versions are incompatible.
- GitHub Release artifacts:
  - extension package,
  - native host package,
  - installer scripts.
- Improved macOS installer flow with clearer folder selection and update guidance.
- Chrome Web Store preparation:
  - permission review,
  - privacy wording,
  - packaged extension build,
  - store listing assets.

### Non-Goals

- No mandatory automatic native host update yet.
- No new sync architecture in this release.

### Acceptance Criteria

- Users can identify and fix version mismatches from the panel.
- Release artifacts are reproducible from the repository.
- The Chrome Web Store review package has minimal required permissions and clear data-flow documentation.

## v0.5.0: Cross-Platform Native Host

**Goal:** Support Windows and Linux in addition to macOS.

### Planned Work

- Abstract native host manifest paths and installer behavior by platform.
- Windows PowerShell installer and uninstall flow.
- Linux installer and uninstall flow for common Chrome/Chromium locations.
- Cross-platform Codex CLI and TeX tool discovery.
- Path separator, shell quoting, newline, and file permission compatibility.
- GitHub Actions matrix for macOS, Windows, and Linux.

### Acceptance Criteria

- Native messaging install/uninstall is tested on all supported platforms.
- Mirror workspace path handling is platform-neutral.
- Existing macOS behavior remains unchanged.

## v0.6.0: Editor-Native Review UX

**Goal:** Make review and acceptance feel closer to a native editor workflow.

### Planned Work

- Inline diff decorations in the Overleaf editor.
- Per-hunk accept and reject.
- Jump from the panel diff to the changed editor location.
- Better large-diff rendering and summarization.
- Keyboard shortcuts for common panel actions.

### Non-Goals

- Do not bypass the current stale-write guard.
- Do not require Overleaf editor internals that lack fallback behavior.

### Acceptance Criteria

- Users can review and accept small edits without leaving the editor context.
- Large diffs remain readable and do not freeze the panel.
- Existing panel diff review remains available as fallback.

## v0.7.0: Asset, Compile, and Local Skill Workflows

**Goal:** Close the loop for LaTeX tasks: inspect, edit, upload assets, compile, and report.

**Status:** Completed in the v0.8 delivery alongside governance hardening. Turn-scoped composer attachments, binary create/overwrite reporting, unsupported binary summaries, compile-context reporting, project custom instructions, and project-local skills are implemented under the governed writeback path.

### Planned Work

- Composer attachment support for user-provided context:
  - pasted or dropped files,
  - PDFs,
  - images such as PNG, JPG, JPEG, and SVG.
- Safe binary writeback for Codex-generated or user-selected assets:
  - explicit confirmation before adding or replacing non-text files,
  - file-size limits,
  - clear reporting for unsupported binary changes.
- More reliable `@compile-log` capture and freshness tracking.
- Workflow for "inspect compile error -> edit -> recompile -> report remaining errors".
- Project-level custom instructions / personalization settings:
  - a settings button in the panel header,
  - a project-scoped "custom instructions" editor for terminology, style notes, venue constraints, and reusable LaTeX conventions,
  - injection of the saved instructions into each Codex turn for that Overleaf project.
- Codex Overleaf local skills:
  - install local writing/checking skills into a project-scoped `.codex-overleaf/skills` area,
  - load selected local skills into Codex task context,
  - keep project skills local and visible to the user before use.
- Better summaries that distinguish changed files, skipped files, generated local artifacts, and remaining compile issues.

### Non-Goals

- No multi-model comparison as a default workflow.
- No automatic upload of arbitrary generated binary files without user confirmation.
- No execution of untrusted project-local scripts as part of skill loading.

### Acceptance Criteria

- A user can upload a PDF or image into the Overleaf project from the Codex panel and reference it from LaTeX.
- A Codex task that produces a supported asset can present it for confirmation and then upload it to Overleaf.
- Compile-error repair tasks produce a clear final report with remaining errors or confirmation of a clean compile.
- Old compile logs are not reused after source changes.
- Generated unsupported artifacts are reported clearly with file path, type, size, and reason.
- Project-local skills can be installed, listed, enabled for a task, and loaded into Codex context without touching the user's global Codex configuration.

## v0.8.0: Collaboration and Governance

**Goal:** Make AI-assisted edits safer in shared Overleaf projects.

**Status:** Completed. The release combines the remaining v0.7 asset/local-skill work with v0.8 audit logs, file governance rules, sensitive-content preflight, collaborator conflict explanations, and redacted diagnostic export.

### Planned Work

- Local audit log for prompt, files touched, diff summary, timestamp, and result.
- Project-level writable/read-only file rules.
- Local sensitive-content checks before sending context to Codex.
- Better collaborator conflict explanations.
- Exportable diagnostic bundle for issue reports, excluding project content by default.

### Non-Goals

- No default telemetry.
- No hosted audit-log service.

### Acceptance Criteria

- A user can explain what Codex changed and why from local records.
- The extension can block writes to configured read-only paths.
- Diagnostics are useful for bug reports without exposing paper content by default.

## v0.9.0: Release Candidate Hardening

**Goal:** Freeze features and validate the product against real workflows.

**Status:** Implemented as the v0.9 release-candidate hardening release. Automated
release gates, smoke tooling, payload safety, page-bridge/native security hardening,
diagnostics privacy tests, documentation, and compatibility templates are in place;
publishing still requires completing the real Overleaf manual smoke checklist and
recording P0/P1 signoff.

### Planned Work

- Real Overleaf smoke-test checklist.
- Large-project performance baseline:
  - 200+ files,
  - binary assets,
  - long `.tex` files,
  - repeated sessions.
- Security review of extension permissions, native messaging, command approval, and local data storage.
- Documentation pass:
  - install,
  - update,
  - uninstall,
  - data directories,
  - FAQ,
  - troubleshooting.
- Compatibility matrix for supported OS, Chrome versions, Codex CLI versions, and Overleaf editor behavior.

### Acceptance Criteria

- No known P0/P1 bugs remain open or are explicitly downgraded before publishing.
- Release-candidate builds pass the full automated test suite and produce verified release artifacts.
- The manual real Overleaf smoke-test checklist is completed before store or GitHub release publication.
- Documentation matches the actual install, update, uninstall, compatibility, and local-data cleanup flow.

## v0.9.5: Architecture Hardening

**Goal:** Reduce release-candidate maintenance risk by splitting oversized implementation
files, locking down skill activation semantics, and turning hardening expectations into
automated gates without adding major user-facing features.

### Planned Work

- Split oversized files into focused modules while preserving the current runtime model:
  - keep `extension/src/contentScript.js` as the content-script composition root,
  - keep `extension/src/pageBridge.js` as the page-world bridge router,
  - move native quota, response-budget, and skill-command approval logic into focused native modules.
- Fix skill activation semantics:
  - enabled Codex and Codex Overleaf skills remain available for normal Codex auto-triggering,
  - a slash-selected skill is treated as a forced skill invocation for the current turn,
  - stale selected skills are ignored when their scope is disabled,
  - disabling local Codex skills must not expose the user's global local skills.
- Add architecture budget checks for the largest files so future release-candidate work
  cannot silently reintroduce the same single-file bloat.
- Add native response-budget boundary tests around the Chrome native messaging frame limit.
- Add skill-installer command red-team tests for unsupported git options, unsafe URL
  schemes, shell wrappers, command substitution, redirection, and path escape attempts.
- Preserve release artifact hygiene: extension and native host packages must not include
  internal specs, plans, test fixtures, docs, previous release output, secrets, or logs.

### Non-Goals

- No new sync architecture.
- No bundler or build-system migration.
- No major UI surface beyond bug fixes required by the skill and settings semantics.
- No change to the governed Overleaf writeback model.

### Acceptance Criteria

- `contentScript.js`, `pageBridge.js`, `codexSessionRunner.js`, and `taskRunner.js`
  are either under their v0.9.5 architecture budgets or have a documented exception
  that fails closed in the budget checker.
- The slash skill flow distinguishes "available for auto-trigger" from "forced for
  this turn" in tests and in native prompt construction.
- Existing v0.9 behavior remains compatible: panel open/close, session history,
  context selection, attachments, settings, diagnostics, ask mode, confirm mode,
  writeback review, and native host compatibility continue to pass smoke testing.
- `npm test`, `npm run verify:release`, and `npm run build:release` pass for `v0.9.5`.
- Release artifacts for `v0.9.5` contain only the packaged extension, native host, and
  installer inputs expected by the release checklist.

## v1.0.0: Production Stable

**Goal:** A stable release that can be recommended for regular academic writing workflows.

**Status:** Release documentation and automated gates are prepared for v1.0.0. Tagging remains gated on the automated matrix, synthetic benchmark gate, architecture budget check, manual smoke signoff, P0/P1 signoff, release artifact verification, privacy-policy publication, and Chrome Web Store submission.

### Required Capabilities

- Stable support for macOS, Windows, and Linux native hosts.
- Clear installation and update path through release artifacts and/or Chrome Web Store.
- Reliable full-snapshot sync with optional OT warm mirror when proven stable.
- Verified writeback, undo, save-state verification, and compile-log workflows.
- Complete public documentation and issue templates.
- No default telemetry.
- Clear local data directory documentation.

### Performance Targets

- Cold task startup under 3 seconds for typical projects when the mirror is already initialized.
- Warm task startup under 1 second when prefetch or OT warm mirror is fresh.
- Large projects with 200+ files remain responsive in the panel.

### Release Criteria

- Full automated test suite passes on macOS, Windows, and Linux.
- `npm run check:architecture` passes with zero current-ceiling exceptions.
- Synthetic large-project regression gate passes on all CI platforms.
- `npm run verify:release` and `npm run build:release` produce v1.0.0 artifacts.
- Manual smoke test passes on all supported platforms, with cold/warm startup timing recorded as observations.
- No known data-loss bugs.
- No known privacy leaks in fixtures, logs, or release artifacts.
- Privacy policy page is live and Chrome Web Store submission has been sent; approval is not required before the GitHub Release tag.
