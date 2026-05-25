# Changelog

## v1.3.8 - 2026-05-25

Reliability and clarity release. This version adds structured failure reasons, a Recent-projects welcome panel on the `/project` URL, a writeback project-ID guard that fails closed on mid-run navigation, and a native-host filter for transient Codex reconnect notifications that was the root cause of "local Codex returned no usable result" failures during network blips. The completion report now visually separates Codex's answer from run metadata, and several UX papercuts around skipped writebacks, post-navigation runs, and tracked-change buttons are smoothed over.

### Added

- **Specific Failure Reasons v1**: a 47-code FailureReason catalog with stage / severity / retryable / terminalState fields. Page-side and content-side writeback paths now emit structured failures, the run card and completion report render the localized userMessage + nextAction, and the same shape persists through the run record so failure reasons survive reload.
- **Recent-projects welcome panel**: on the `/project` URL (no specific project) the panel now renders a cross-project list of recent runs with status badges, instead of an empty per-project session view. Accounts are scoped via a SHA-256 hashed account identity (no display-name fallback) so projects from different Overleaf accounts stay isolated.
- **Writeback project-ID guard**: every `applyOperations` / `acceptTrackedChanges` / `rejectTrackedChanges` dispatch is gated by a `runProjectId` vs page-side `editorProjectId` check. Mid-run SPA navigation to a different project aborts with `aborted_project_changed`; an unhydrated editor produces `editor_project_id_unavailable`. The guard is hydration-tolerant — it retries the page-side reader with a 100/300/700 ms backoff (~1100 ms ceiling) before failing closed, so runs that start during Overleaf's initial hydration window now succeed instead of misleadingly reporting "Refresh Overleaf and retry".
- **`codex_project_locked` failure reason**: when a second Codex task is started for the same Overleaf project while the first is still running, the run card shows "Codex task already running" with a `blocked` (not `failed`) status and clear next-step guidance.
- **Native-host transient reconnect filter**: Codex app-server "Reconnecting X/Y" notifications during network blips are now classified as warnings instead of fatal errors, so the turn keeps running and surfaces the actual answer once the connection recovers. The reconnect line is shown in the run timeline as its visible title (e.g. "Reconnecting... 2/5") instead of a generic "error".
- **Run record carries `runProjectId`**: the project the run was bound to is persisted on the run record across reload (used by the writeback guard, the post-navigation settlement, and the undo writeback path).

### Changed

- **Completion report visually separates conclusion from system metadata**: the human-language conclusion keeps the existing 13 px contrast, while `Why nothing changed` / `Write result` / `Undo` / `Next` render in a dedicated `<dl>` meta block beneath a thin separator at 11.5 px in muted color. Failed-status reports keep the alert color on the conclusion but the meta stays muted so it reads as run metadata rather than amplifying the alert.
- **Post-navigation run settlement**: after the user navigates away from the project a still-running task was bound to, the run settles into one of `background_completed` (writeback applied), `needs_review_after_navigation` (partial), or `abandoned_after_navigation` (no usable result). Each carries a human-readable statusText, and the panel CSS gives `needs_review_after_navigation` its own warning color and `abandoned_after_navigation` the same red as `failed` so the run timeline no longer shows two visually inconsistent "Failed" badges.
- **Misleading "no usable result" fallback retired when Codex actually returned**: `translateRawError` now accepts a `codexReturned` context flag. When Codex's assistant message landed on the stream before an unrelated exception escaped the outer catch, the conclusion now reads "Codex returned a result, but local post-processing of this run failed" instead of "local Codex returned no usable result, so no writes were confirmed". The legacy copy still fires for genuine no-result paths.
- **Better "empty result" copy**: when Codex completes a turn with no assistant message and no file changes, the run report now reads "Codex completed, but it produced no assistant response and no local file changes" with explicit retry guidance instead of the generic "Codex finished but did not return a usable result".
- **`needs_review` tracked-change runs** now show the same primary Accept / Undo buttons as `pending` — the previous "needs review" labels were confusing UX for an internal retryable proof state.
- **Settings back button respects the current route**: clicking Back from Settings on the `/project` URL now returns to the Recent-projects variant instead of unconditionally rendering the per-project session view.
- **Codex Overleaf skills entry** now shows a single, clean row name (with the underlying id as the tooltip) and the enabled count refreshes immediately after toggles.
- **Batch-level guard skip header** now reads "writeback process was not written" instead of the misleading "unknown file: process was not written" when the write-guard fires before any per-op dispatch.
- **`recentProjects_badge_needs_review` / `_needs_review_after_navigation`** simplified to "pending" / "待处理" to match the executable state the buttons present.
- Release metadata alignment: bumped the package, lockfile, extension manifest, compatibility target, and release tracking metadata for the v1.3.8 release.
- Bumped package, extension manifest, compatibility target, README release commands, and release tracking metadata to `1.3.8` while keeping native protocol `1`.
- Current release artifact names now resolve to `codex-overleaf-link-extension-v1.3.8.zip`, `codex-overleaf-native-host-v1.3.8.tar.gz`, and `codex-overleaf-link-1.3.8.tgz`.
- Native host install remains `npm exec --yes codex-overleaf-link@1.3.8 -- install-native`.
- Native host diagnostics remain `npm exec --yes codex-overleaf-link@1.3.8 -- doctor`.
- Native host uninstall is `npm exec --yes codex-overleaf-link@1.3.8 -- uninstall-native`.

### Fixed

- **Write-guard batch-skip crash that masked partial-sync conclusions**: when the guard fired, the skip entry carried `operation: null` but `summarizeOperationForAudit(operation = {}, ...)` only defaulted on `undefined` — `null.path` threw `TypeError`, the outer catch swallowed the partial-sync report, and the user saw the misleading "local Codex returned no usable result" fallback. The summarizer now normalizes null/undefined inside the body, and both guard emit sites use `operation: {}` to match the function's signature intent.

### Notes

- Native protocol stays `1`; this release adds structured FailureReason content, the welcome panel, the writeback project-ID guard, and the reconnect-tolerant native host path, not the native messaging protocol.
- The write-guard hydration retry adds up to ~1100 ms of latency only on writes that hit Overleaf's hydration window; the steady-state happy path is unchanged.

## v1.3.7 - 2026-05-23

Accept changes release. This version adds a per-run **Accept changes** control on the run card so a Codex run's Overleaf tracked changes can be accepted in one click — the accept counterpart of the existing Undo — along with release metadata alignment for the v1.3.7 packaging, compatibility, and release tracking surfaces.

### Added

- Per-run **Accept changes** control on the run card (positioned before Undo) that accepts all of the current run's Overleaf tracked changes in one click and drives the run to a terminal accepted state. The mechanism first reverts the run's tracked writeback via the same editor-undo path the existing Undo relies on, then replays the run's own original forward patches as a non-tracked edit so the run's content lands as plain permanent text. The replay waits for Overleaf's Editing mode to remain stable before each per-op write, watches for fresh tracked changes during the write, and rolls back via editor-undo if Overleaf reintroduces tracked changes — leaving the run pending and the document unchanged rather than silently double-tracking.
- New `trackedChangeStatus` per-run lifecycle field with three stable values (`pending` / `accepted` / `rejected`); Accept changes and Undo are mutually exclusive terminal actions and both buttons stay visible but disabled at terminal so the run card always shows the lifecycle clearly.

### Changed

- Release metadata alignment: bumped the package, lockfile, extension manifest, compatibility target, and release tracking metadata for the v1.3.7 release.
- Bumped package, extension manifest, compatibility target, README release commands, and release tracking metadata to `1.3.7` while keeping native protocol `1`.
- Current release artifact names now resolve to `codex-overleaf-link-extension-v1.3.7.zip`, `codex-overleaf-native-host-v1.3.7.tar.gz`, and `codex-overleaf-link-1.3.7.tgz`.
- Native host install remains `npm exec --yes codex-overleaf-link@1.3.7 -- install-native`.
- Native host diagnostics remain `npm exec --yes codex-overleaf-link@1.3.7 -- doctor`.
- Native host uninstall is `npm exec --yes codex-overleaf-link@1.3.7 -- uninstall-native`.

### Notes

- Native protocol stays `1`; this release adds the Accept changes UI and lifecycle, not the native messaging protocol.
- Accept changes leaves Overleaf in Editing mode after a successful replay (Track Changes is not auto-re-enabled) to avoid Overleaf re-tracking the just-replayed text; turn Reviewing / Track Changes back on manually once Overleaf has saved the accepted text.

## v1.3.6 - 2026-05-22

Writeback patch granularity release, with release metadata alignment for the v1.3.6 packaging, compatibility, and release tracking surfaces. This version makes Overleaf writeback patches match editing intent so reviewed changes land as coherent units, and fixes Reviewing-mode undo and a hardcoded-Chinese restored-run message.

### Changed

- Overleaf writeback patches are now generated to match editing intent: a paragraph rewrite produces one coherent paragraph patch/hunk, a sentence rewrite one sentence patch, and a newly inserted annotated-rewrite `% [original]` / `% [revised]` block one block patch, while small word fixes stay small token patches and far-apart edits stay independent. This replaces the previous token-minimizing strategy that fragmented a paragraph rewrite into many tiny tracked changes in Overleaf Reviewing.
- Release metadata alignment: bumped the package, lockfile, extension manifest, compatibility target, and release tracking metadata for the v1.3.6 release.
- Bumped package, extension manifest, compatibility target, README release commands, and release tracking metadata to `1.3.6` while keeping native protocol `1`.
- Current release artifact names now resolve to `codex-overleaf-link-extension-v1.3.6.zip`, `codex-overleaf-native-host-v1.3.6.tar.gz`, and `codex-overleaf-link-1.3.6.tgz`.
- Native host install remains `npm exec --yes codex-overleaf-link@1.3.6 -- install-native`.
- Native host diagnostics remain `npm exec --yes codex-overleaf-link@1.3.6 -- doctor`.
- Native host uninstall is `npm exec --yes codex-overleaf-link@1.3.6 -- uninstall-native`.
- Reorganized the README install section into two clear paths — the installer script (sets up the native host and the extension) and npm (native host only).

### Fixed

- Reviewing-mode undo could leave a wide paragraph rewrite only partially reverted; undo now uses the writeback's verified post-write content instead of a re-derivation that could drift from the editor state.
- The restored-run "stopped tracking after a page refresh" messages were hardcoded in Chinese and showed Chinese text in the English UI; they are now localized.

### Notes

- Native protocol stays `1`; this release changes writeback patch granularity, undo handling, localization, and packaging metadata, not the native messaging protocol.

## v1.3.5 - 2026-05-22

Personalization isolation and settings experience release, with release metadata alignment for the v1.3.5 packaging, compatibility, and release tracking surfaces. This version stops the plugin Codex home from inheriting global Codex personalization, ships a new bundled annotated-rewrite skill, and reworks settings into a full-screen view with unified auto-save and per-skill enable toggles.

### Added

- Bundled the official `annotated-rewrite` Codex Overleaf skill: when rewriting `.tex` content it comments out the original under a `% [original]` marker and writes the replacement under a `% [revised]` marker so the before/after diff stays visible in the source.
- Added a save-status indicator to the settings panel that reflects unified auto-save state.
- Added per-skill enable/disable toggles so each Codex Overleaf skill can be turned on or off individually, honored at run time.

### Changed

- Release metadata alignment: bumped the package, lockfile, extension manifest, compatibility target, and release tracking metadata for the v1.3.5 release.
- Bumped package, extension manifest, compatibility target, README release commands, and release tracking metadata to `1.3.5` while keeping native protocol `1`.
- Current release artifact names now resolve to `codex-overleaf-link-extension-v1.3.5.zip`, `codex-overleaf-native-host-v1.3.5.tar.gz`, and `codex-overleaf-link-1.3.5.tgz`.
- Native host install remains `npm exec --yes codex-overleaf-link@1.3.5 -- install-native`.
- Native host diagnostics remain `npm exec --yes codex-overleaf-link@1.3.5 -- doctor`.
- Native host uninstall is `npm exec --yes codex-overleaf-link@1.3.5 -- uninstall-native`.
- The plugin Codex home no longer inherits the user's global Codex personalization: it no longer copies `~/.codex/AGENTS.md`, strips the top-level `personality` key from the copied `config.toml`, and no longer symlinks the `rules` and `memories` directories, with stale-state cleanup of those entries from previously prepared Codex homes.
- Reworked the settings panel into a full-screen in-panel view with back navigation instead of a floating popup overlay.
- Unified settings auto-save: every settings field now saves automatically and the explicit Save button was removed.
- Moved Codex Overleaf skill management to a dedicated settings sub-page with sliding-switch controls, an inline remove-confirmation, and loading states.

### Fixed

- Stopped fullwidth CJK punctuation from being absorbed into file-path tokens when parsing clickable line references.

### Notes

- Native protocol stays `1`; this release changes packaging metadata, personalization isolation, and the settings experience, not the native messaging protocol.

## v1.3.0 - 2026-05-20

Nested Overleaf file writeback stabilization release. This version focuses on making subdirectory file edits reliable after the user switches between files, and on aligning extension/native version surfaces for release diagnostics.

### Changed

- Bumped package, extension manifest, compatibility target, README release commands, and release tracking metadata to `1.3.0` while keeping native protocol `1`.
- Current release artifact names now resolve to `codex-overleaf-link-extension-v1.3.0.zip`, `codex-overleaf-native-host-v1.3.0.tar.gz`, and `codex-overleaf-link-1.3.0.tgz`.
- Native host install remains `npm exec --yes codex-overleaf-link@1.3.0 -- install-native`.
- Native host diagnostics remain `npm exec --yes codex-overleaf-link@1.3.0 -- doctor`.
- Native host uninstall is `npm exec --yes codex-overleaf-link@1.3.0 -- uninstall-native`.

### Fixed

- Hardened nested file-tree navigation so writeback waits for the target CodeMirror document to load before replacing editor content.
- Fixed blank target-file readiness handling so empty subdirectory files do not falsely match before Overleaf has switched the editor document.
- Preserved structured writeback diagnostics in skipped-result reporting for future stale-write investigations.

## v1.2.6 - 2026-05-20

Release metadata alignment patch for v1.2.6 packaging, compatibility, and release tracking surfaces, plus a nested Overleaf file writeback safety fix.

### Fixed

- Fixed nested Overleaf file-tree path resolution for folder-list DOM layouts where a folder row and its child file list are siblings instead of DOM ancestors.
- Hardened writeback so Codex verifies the active CodeMirror document belongs to the requested project-relative path before applying edits.
- Forced a target-file reopen when the file tree selected path and the active editor document are out of sync, preventing edits intended for files such as `example/test.tex` from being applied to `main.tex`.

### Changed

- Bumped package, extension manifest, compatibility target, README release commands, and release tracking metadata to `1.2.6` while keeping native protocol `1`.
- Current release artifact names now resolve to `codex-overleaf-link-extension-v1.2.6.zip`, `codex-overleaf-native-host-v1.2.6.tar.gz`, and `codex-overleaf-link-1.2.6.tgz`.
- Native host install remains `npm exec --yes codex-overleaf-link@1.2.6 -- install-native`.
- Native host diagnostics remain `npm exec --yes codex-overleaf-link@1.2.6 -- doctor`.
- Native host uninstall is `npm exec --yes codex-overleaf-link@1.2.6 -- uninstall-native`.

## v1.2.1 - 2026-05-15

Stability patch for the public v1.2 distribution path.

### Changed

- Hardened content runtime initialization against duplicate injection on long-lived Overleaf tabs.
- Added compact overlay panel behavior for narrow browser windows so the Overleaf editor is not squeezed below a usable width.
- Hardened the tag release workflow to build and verify GitHub Release artifacts before npm publication, with retrying npm visibility checks.
- Updated uninstall documentation to lead with npm-first native host commands.
- Added a total composer attachment size limit while preserving the existing per-file and count limits.
- Expanded line reference handling for complex Markdown/local path cases while preserving local path sanitization.
- Native host install remains `npm exec --yes codex-overleaf-link@1.2.1 -- install-native`.
- Native host diagnostics remain `npm exec --yes codex-overleaf-link@1.2.1 -- doctor`.
- Native host uninstall is `npm exec --yes codex-overleaf-link@1.2.1 -- uninstall-native`.

## v1.2.0 - 2026-05-13

Release metadata alignment patch for v1.2 packaging, compatibility, and release tracking surfaces.

### Changed

- Bumped package, extension manifest, compatibility target, README release commands, and native ping metadata to `1.2.0` while keeping native protocol `1`.
- Current release artifact names now resolve to `codex-overleaf-link-extension-v1.2.0.zip`, `codex-overleaf-native-host-v1.2.0.tar.gz`, and `codex-overleaf-link-1.2.0.tgz`.
- Release tracking tests now assert v1.2.0 package, lockfile, extension, and compatibility metadata alignment.

## v1.1.3 - 2026-05-12

Release pipeline hardening patch for checksum-verifiable GitHub assets and npm-first release consistency.

### Changed

- Release builds now publish top-level native helper assets whose names match `SHA256SUMS` and `release-manifest.json`.
- CI now runs release metadata/source hygiene and npm package manifest checks on normal main and PR workflows.
- The tag release workflow now publishes or verifies the npm package before publishing the GitHub Release.
- README installation guidance is npm-first for native-host setup and uses the GitHub Release extension zip as the primary unpacked extension source.
- Bumped package, extension manifest, compatibility target, and native ping metadata to `1.1.3` while keeping native protocol `1`.

## v1.1.2 - 2026-05-11

Release hygiene patch for public source and package surfaces.

### Changed

- Removed internal roadmap and release-planning docs from the public tracked source tree and release source archives.
- Updated release verification to reject tracked `ROADMAP.md`, `docs/`, and generated npm package manifest artifacts.
- Kept npm/native release artifacts document-free while preserving npm-first install, doctor, and uninstall commands.
- Bumped package, extension manifest, compatibility target, and native ping metadata to `1.1.2` while keeping native protocol `1`.

### Fixed

- Avoided fake secret literals in tests that can trigger external secret scanners despite not being real credentials.

## v1.1.1 - 2026-05-08

Small native-host update guidance patch for npm-first local installs.

### Changed

- Popup and panel native-host mismatch guidance now recommends the pinned npm CLI command: `npm exec --yes codex-overleaf-link@1.1.1 -- install-native`.
- Official release update commands omit `--extension-id` for the bundled stable extension id, while custom/dev unpacked extension ids still preserve the explicit `--extension-id` recovery path.
- README and manual release checklist now treat GitHub Release `install.sh` / `install.ps1` scripts as fallback installers instead of the primary native-host update command.
- Bumped package, extension manifest, compatibility target, and native ping metadata to `1.1.1` while keeping native protocol `1`.

## v1.1.0 - 2026-05-08

Version alignment and manual GitHub Release distribution guidance for the v1.1 native-host package.

### Added

- npm native installer CLI guidance with release-pinned `npm exec` install, doctor, and uninstall commands.
- Native doctor command documentation for diagnosing the installed native host without installing the Chrome extension.
- npm package content gates that verify the package includes only the intended native-host runtime files.
- Manual extension release checklist for the current GitHub Release/unpacked-extension distribution path.

### Changed

- Bumped package, extension manifest, compatibility target, and native ping metadata to `1.1.0` while keeping native protocol `1`.
- Documented that npm installs, updates, uninstalls, and diagnoses the native host only, and that the Chrome extension must be installed separately.
- Kept official native-host installs one-command by defaulting to the bundled stable extension id, while preserving `--extension-id` for custom or mismatched unpacked builds.
- Documented the safe runtime root copy used by the npm/native installer path.
- Shifted v1.1.0 release guidance to GitHub Release artifacts plus manual unpacked extension loading without requiring normal users to copy an extension id.

## v1.0.0 - 2026-05-07

Production-stable release documentation and gate hardening for regular academic writing workflows across macOS, Windows, Linux Chrome, and Linux Chromium.

### Added

- Synthetic large-project regression gate support for v1.0 CI, including snapshot, mirror sync, diff/patch, context tray, storage preparation, native frame size, and internal benchmark failure assertions.
- Static HTML privacy policy page for Chrome Web Store listing and GitHub Pages publication.
- README Quick Start and Common Workflows sections for first-time install, safe Ask/Suggest usage, compile-error repair, paragraph rewrite, and translation workflows.

### Changed

- Bumped package metadata, README install/update commands, release artifact names, Chrome Web Store checklist references, and release docs to `v1.0.0`.
- `npm run check:architecture` now enforces final v1.0 `maxLines` budgets by default with no `currentCeiling` exceptions.
- CI release gates now include architecture budget enforcement and the synthetic large-project regression gate on macOS, Windows, and Linux with one retry for runner variance.
- ROADMAP v1.0 status now reflects production-stable release criteria and the required gate checklist.

### Notes

- Chrome Web Store approval remains a soft gate; rejection is handled as a follow-up `v1.0.1` patch while the GitHub Release path remains available.
- Manual smoke signoff records startup timing as observations only; synthetic CI ceilings are regression guards, not real-world latency promises.

## v0.9.5 - 2026-05-07

Architecture hardening release for the v0.9 release-candidate line. This version focuses on reducing maintenance risk in the largest files, correcting project skill activation semantics, and tightening release gates without adding major user-facing surface area.

### Added

- Focused content-script modules for composer attachments, diff review rendering, and the context tray while keeping `contentScript.js` as the composition root.
- Focused page-bridge capability guard, native request quota, and native response-budget modules.
- Architecture budget checks for the largest content, page-bridge, and native runner files, including explicit exceptions for files that still need follow-up splitting.
- Regression tests for Codex Overleaf skill auto-trigger availability, slash-selected forced skill invocation, and hidden project-local skill non-exposure.
- Release tracking tests that ensure manifest-loaded extension files and native relative `require()` targets are git-tracked before packaging.

### Changed

- Bumped package, extension, README, release artifact, and native compatibility metadata to `0.9.5`.
- Codex Overleaf skills remain materialized into the plugin-scoped Codex home when enabled, so unselected plugin skills can participate in normal Codex skill triggering without exposing the user's global Codex local skills.
- Slash-selected Codex Overleaf skills are treated as forced turn-scoped invocations, while stale selections are ignored when their skill scope is disabled.
- Project-local skills are no longer shown in settings or exposed to normal UI runs; the legacy native API remains for compatibility.
- Architecture checks now fail if oversized files grow beyond their documented v0.9.5 exception ceilings.

### Fixed

- Disabled user-local Codex skills no longer leak back into runs through the project skill path.
- Release hygiene now catches newly split extension/native modules that would otherwise be omitted by `git ls-files`-based artifact packaging.

## v0.9.0 - 2026-05-07

Release-candidate hardening release. This version focuses on release gates, real workflow smoke coverage, payload safety, security/privacy hardening, and public documentation accuracy rather than new product surface area.

### Added

- A redacted Chrome smoke runner with `panel`, `native`, `project`, `diagnostics`, and `all` probes, plus JSON output for release-candidate evidence.
- A real Overleaf release-candidate checklist covering install/update, ask/suggest/auto/undo/compile/context, attachments, governance, sensitive preflight, local skills, stale conflicts, and diagnostics redaction.
- A synthetic large-project benchmark with 250+ files, long `.tex` files, binary assets, oversized binary degradation, repeated session state, and required performance metrics.
- Public compatibility and troubleshooting documentation for Chrome/Chromium support, native host paths, local data cleanup, diagnostics, skill toggles, and issue reports.
- Regression tests for diagnostics/session redaction, task/native request quotas, smoke redaction, final native response sizing, and issue-template release triage fields.

### Changed

- Bumped package, extension, README, release artifact, and native compatibility metadata to `0.9.0`.
- Native compatibility now requires a v0.9 native host so extension and bridge agree on release-candidate gates, quotas, diagnostics behavior, and skill-installer containment.
- Diagnostics export now favors allowlisted summaries over broad raw object redaction.
- Smoke and diagnostics paths report counts, byte sizes, capability status, and error categories without project text, prompt bodies, compile logs, diffs, binary data, or raw secrets.
- Windows pinned install/update and native mismatch recovery docs now explicitly set `CODEX_OVERLEAF_REF`.

### Fixed

- Final native responses now degrade oversized text writeback before native message encoding instead of allowing content, previous content, diffs, or patches to exceed the output frame limit.
- Oversized binary writeback now produces explicit unsupported-change guidance instead of inlining payloads that can exceed native message limits.
- Page-bridge requests now reject spoofed or unsafe paths before browser mutation while preserving authorized e2e writeback flows.
- Skill installer command approval is constrained to safe read-only inspection and contained HTTPS `git clone` writes under Codex Overleaf skill roots.
- Native request quotas now cover project snapshots, file overlays, proposed operations, secondary operations, compile logs, attachments, and skill content before mirror mutation or confirm-plan creation.
- Project file listing preserves real Overleaf folder hierarchy and ZIP byte-size metadata without reading or exposing file contents for list-only contexts.

### Notes

- Native protocol remains `1`; this release uses version and capability gates because v0.9 extension and native host behavior must match.
- Actual Chrome Web Store submission and real Overleaf manual smoke signoff remain release-process steps after artifacts are built.
- There is still no hosted telemetry; diagnostics and audit data remain local and redacted by default.

## v0.8.0 - 2026-05-06

Governed attachment, binary asset, and local skill release. This version completes the remaining v0.7 turn-scoped attachment and local skill workflows, then adds the v0.8 collaboration governance layer for safer shared Overleaf projects.

### Added

- Composer paste/drop attachments for PDFs, images, and files as turn-scoped Codex context without writing them to Overleaf.
- Binary asset change collection for Codex-created PDFs and images, with explicit confirmation before create or overwrite writeback.
- Project-local skill install, list, enable, remove, and prompt injection through the native host without touching the user's global Codex configuration.
- Local audit records for Codex runs, including prompt metadata, selected files, summaries, skipped changes, governance decisions, and result status.
- Project-level writable and read-only file rules that block matching writeback operations before browser mutation.
- Sensitive-content preflight checks before sending project context to Codex.
- Exportable diagnostic bundles that redact project content by default while preserving platform, native host, compatibility, audit, and failure metadata.

### Changed

- Bumped package, extension, README, release artifact, and native compatibility metadata to `0.8.0`.
- Native compatibility now requires the `localSkills` capability so older native hosts cannot silently miss v0.8 project skill requests.
- Writeback mapping now preserves binary create and overwrite operations through the extension and reports unsupported browser binary paths instead of downgrading them to empty text files.
- Root-level PDFs are treated as user assets unless they match known generated output names or a matching root TeX source.

### Fixed

- Binary deletions from the local mirror are reported as unsupported changes instead of disappearing from the final summary.
- Sensitive scanning now catches modern `sk-...` OpenAI-style API tokens as well as older secret formats.
- Governance move and rename checks now evaluate the destination path when applying read-only and writable rules.
- Missing selected local skills now produce explicit run timeline events and prompt context.

### Notes

- Native protocol remains `1`; this release uses the capability and version compatibility gate because extension and native host must both understand governed assets and local skills.
- Diagnostics, audit logs, rules, and selected skills are local browser/native state only; this release adds no hosted telemetry.

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
