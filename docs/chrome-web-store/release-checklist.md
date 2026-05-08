# Chrome Web Store Release Checklist

This checklist is the release gate for the current package version. Keep the
artifact names aligned with `package.json` before running `npm run verify:release`.

## Automated Verification

- Run `npm test`.
- Run `npm run check:architecture`.
- Run `npm run benchmark:large -- --output .local/benchmarks/v1.1-large-project.json`.
- Run `npm run verify:release`.
- Run `npm run build:release`.
- Confirm the GitHub release workflow has passing macOS, Linux, and Windows jobs for tests, architecture budget enforcement, and the synthetic large-project regression gate.

## Release Artifact Hygiene

- Verify checksums from `dist/releases/v1.1.0/SHA256SUMS`.
- Inspect extension zip `codex-overleaf-link-extension-v1.1.0.zip` before upload.
- Inspect native host tarball `codex-overleaf-native-host-v1.1.0.tar.gz` before upload.
- Confirm release artifacts exclude `docs/`, `docs/superpowers/`, `.local/`, `.git/`, `test/`, `dist/`, `build/`, README, changelog, roadmap, specs, plans, keys, certificates, logs, sqlite files, and `.crx` files.
- Confirm the release `install.sh` defaults `CODEX_OVERLEAF_REF` to `v1.1.0`.
- Confirm the release `install.ps1` defaults `$DefaultRef` to `v1.1.0`.
- Confirm the privacy policy URL is live and linked from the Chrome Web Store listing.
- Confirm screenshots and listing copy are captured from the v1.1.0 build.
- Record the Chrome Web Store extension id.
- Confirm native host installer guidance includes the Web Store extension id in `allowed_origins` in addition to the unpacked id before Web Store publication.
- Confirm npm native installer guidance is pinned for v1.1.0 and uses the final Web Store or dev/unpacked extension id before publication: `npm exec --yes codex-overleaf-link@1.1.0 -- install-native --extension-id <chrome-extension-id>`.
- Confirm npm native diagnostics guidance is pinned for v1.1.0: `npm exec --yes codex-overleaf-link@1.1.0 -- doctor`.

## Real Overleaf Smoke

- Install the extension and native host from the built artifacts on a clean browser profile.
- Open a real Overleaf project and confirm panel injection, native bridge compatibility, project snapshot availability, and diagnostics access.
- Record the project URL origin, hashed project id, extension version, native compatibility result, timing notes, and pass/fail status without recording project text, prompts, compile logs, diffs, secrets, or binary data.

### Platform-Aware v1.1 Smoke Matrix

For every row below, record: platform, browser version, extension id/install mode,
native version, Codex CLI version, Overleaf project shape, pass/fail, notes, timing observations where applicable, and artifact or screenshot reference. Artifacts must not contain project text, prompt
text, compile logs, diffs, binary data, raw secrets, or unredacted project ids.

| # | Scenario | Platform | Browser version | Extension id / install mode | Native version | Codex CLI version | Project shape | Pass/Fail | Notes | Artifact/screenshot |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Install native host with the platform-specific installer |  |  |  |  |  |  |  |  |  |
| 2 | Update native host by re-running the pinned v1.1.0 installer |  |  |  |  |  |  |  |  |  |
| 3 | Native host missing recovery |  |  |  |  |  |  |  |  |  |
| 4 | Native host update-required recovery from a v0.9.5 native host with v1.1 extension UI |  |  |  |  |  |  |  |  |  |
| 5 | Open real Overleaf project and verify panel appears |  |  |  |  |  |  |  |  |  |
| 6 | Ask-only task does not write to Overleaf |  |  |  |  |  |  |  |  |  |
| 7 | Suggest task shows diff and writes only after approval |  |  |  |  |  |  |  |  |  |
| 8 | Auto task writes only when checkpoint or verified Reviewing precondition is met |  |  |  |  |  |  |  |  |  |
| 9 | Undo restores written content |  |  |  |  |  |  |  |  |  |
| 10 | Compile action reports clean/failed compile state |  |  |  |  |  |  |  |  |  |
| 11 | `@file`, `@compile-log`, and `@current-section` context work without leaking content into artifacts |  |  |  |  |  |  |  |  |  |
| 12 | Paste/drop image, PDF, or file as turn-scoped attachment |  |  |  |  |  |  |  |  |  |
| 13 | Binary create/overwrite requires confirmation or reports an explicit unsupported reason |  |  |  |  |  |  |  |  |  |
| 14 | Governance readonly/writable rule blocks the expected write |  |  |  |  |  |  |  |  |  |
| 15 | Sensitive preflight blocks a fake token and does not display the raw secret |  |  |  |  |  |  |  |  |  |
| 16 | Local Codex skills disabled means user/system skills are not visible to the run |  |  |  |  |  |  |  |  |  |
| 17 | Codex Overleaf project skills enabled means project/plugin skill can be used |  |  |  |  |  |  |  |  |  |
| 18 | Stale/collaborator conflict produces an understandable user-facing report |  |  |  |  |  |  |  |  |  |
| 19 | Diagnostics export contains no project text or prompt body |  |  |  |  |  |  |  |  |  |
| 20 | Native update guidance badge, modal, and correct platform command |  |  |  |  |  |  |  |  |  |
| 21 | Linux Chromium installer/update works with `--browser chromium` | Linux Chromium only |  |  |  |  |  |  |  |  |
| 22 | Windows PowerShell installer prints correct source, runtime, bridge, and manifest paths | Windows only |  |  |  |  |  |  |  |  |
| 23 | macOS installer opens Finder shortcut and Chrome extension page | macOS only |  |  |  |  |  |  |  |  |
| 24 | Cold startup timing recorded from Send click to first Codex stream event | Observation only |  |  |  |  |  |  |  |  |
| 25 | Warm startup timing recorded with fresh prefetch or OT warm mirror | Observation only; Linux Chromium optional |  |  |  |  |  |  |  |  |

Recommended smoke command for a logged-in profile:

```bash
npm run smoke:extension -- --url https://www.overleaf.com/project/<project-id> --profile-dir <logged-in-profile> --probe all --json .local/smoke/v1.1-signoff.json
```

Record results in `.local/smoke/v1.1-signoff.json` and do not commit it. The file must not contain project text, prompts, compile logs, raw diffs, binary data, raw secrets, or unredacted project ids.

## Large-Project Performance Baseline

- Run `npm run benchmark:large -- --output .local/benchmarks/v1.1-large-project.json`.
- Assert `snapshot.total_ms < 5000`, `mirror.sync_ms < 3000`, `diff.compute_ms + patch.compute_ms < 1000`, `native.output_frame_bytes <= 1 MiB`, `context_tray.render_ms < 500`, `storage.prepare_ms < 500`, and an empty `failures` array.
- Treat these as generous synthetic regression ceilings, not real-world latency promises.
- CI runs the gate on macOS, Windows, and Linux with one automatic retry for runner variance.

## Large-Project Manual Observations

- Record file counts, byte counts, snapshot timing, native payload size, browser payload size, unsupported large-binary writeback results, cold startup timing, warm startup timing, and 200+ file context-tray responsiveness during smoke signoff.
- Cold startup target is under 3 seconds and warm startup target is under 1 second, but these are manual observations and do not automatically block the release.

## Security And Privacy Review

- Review page-bridge spoof resistance, unsafe path rejection, skill-installer containment, native method quotas, diagnostics redaction, and local data documentation.
- Confirm the page-bridge threat model is explicit: same-origin and capability checks reject missing-capability spoof attempts, but the extension does not claim to defend against malicious first-party code already running in the Overleaf page world.
- Confirm diagnostics exports exclude project content, prompt text, compile logs, diffs, binary data, and raw secrets.
- Confirm extension permissions and privacy disclosures match the packaged manifest and runtime behavior.

## Documentation Pass

- Confirm listing copy, privacy notes, and permission notes match the packaged manifest.
- Confirm `docs/privacy-policy.html` mirrors `docs/chrome-web-store/privacy.md`, contains no tracking scripts, and is published at a stable URL.
- Confirm install, update, uninstall, data-directory, FAQ, troubleshooting, compatibility, native mismatch, Quick Start, and Common Workflows docs match the release behavior.
- Capture v1.1.0 screenshots, small promo image, and optional marquee image from the final UI.

## Compatibility Matrix

- Verify install and smoke coverage on macOS, Windows, and Linux.
- Record Chrome version, extension version, native host version, minimum supported native host version, and any platform-specific exceptions.
- Record final Web Store extension id before native-host installer publication.
- Reinstall the native host with that id so `allowed_origins` matches the store extension.

### Documentation And Compatibility Signoff

For each supported row, record the fields below in the release notes or v1.1 signoff artifact bundle. Do not record project text, prompts, compile logs, raw diffs, binary content, raw secrets, or unredacted project ids.

| Field | macOS Chrome | Windows Chrome | Linux Chrome | Linux Chromium |
| --- | --- | --- | --- | --- |
| OS/version/arch |  |  |  |  |
| Browser/channel/version |  |  |  |  |
| Extension install mode | Unpacked / Web Store | Unpacked / Web Store | Unpacked / Web Store | Unpacked / Web Store |
| Extension id |  |  |  |  |
| Installer/update command | `CODEX_OVERLEAF_REF=v1.1.0 bash -c "$(curl -fsSL https://raw.githubusercontent.com/Ghqqqq/codex-overleaf-link/v1.1.0/install.sh)"` | `iwr https://raw.githubusercontent.com/Ghqqqq/codex-overleaf-link/v1.1.0/install.ps1 -OutFile install.ps1`; `$env:CODEX_OVERLEAF_REF='v1.1.0'`; `powershell -ExecutionPolicy Bypass -File install.ps1` | `CODEX_OVERLEAF_REF=v1.1.0 bash -c "$(curl -fsSL https://raw.githubusercontent.com/Ghqqqq/codex-overleaf-link/v1.1.0/install.sh)"` | `CODEX_OVERLEAF_REF=v1.1.0 bash -c "$(curl -fsSL https://raw.githubusercontent.com/Ghqqqq/codex-overleaf-link/v1.1.0/install.sh)" -- --browser chromium` |
| Uninstall command | `node ~/.codex-overleaf/source/scripts/uninstall-native-host.mjs` | `node $env:LOCALAPPDATA\CodexOverleaf\source\scripts\uninstall-native-host.mjs` | `node ~/.codex-overleaf/source/scripts/uninstall-native-host.mjs` | `node ~/.codex-overleaf/source/scripts/uninstall-native-host.mjs --browser chromium` |
| Manifest/registry path | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.codex.overleaf.json` | `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.codex.overleaf` -> `%LOCALAPPDATA%\CodexOverleaf\native-host-runtime\com.codex.overleaf.json` | `~/.config/google-chrome/NativeMessagingHosts/com.codex.overleaf.json` | `~/.config/chromium/NativeMessagingHosts/com.codex.overleaf.json` |
| Bridge/runtime/source path | `~/.codex-overleaf/codex-overleaf-bridge`; `~/.codex-overleaf/native-host-runtime`; `~/.codex-overleaf/source` | `%LOCALAPPDATA%\CodexOverleaf\codex-overleaf-bridge.cmd`; `%LOCALAPPDATA%\CodexOverleaf\native-host-runtime`; `%LOCALAPPDATA%\CodexOverleaf\source` | `~/.codex-overleaf/codex-overleaf-bridge`; `~/.codex-overleaf/native-host-runtime`; `~/.codex-overleaf/source` | `~/.codex-overleaf/codex-overleaf-bridge`; `~/.codex-overleaf/native-host-runtime`; `~/.codex-overleaf/source` |
| Node/Git/Codex/TeX |  |  |  |  |
| Native protocol/capabilities | Protocol 1; native protocol range 1-1; required capabilities: `bridgePing`, `mirrorSync`, `mirrorPatchFiles`, `mirrorStatus`, `codexRun`, `codexCancel`, `codexModels`, `historyClearPlugin`, `localSkills`, `mirrorSensitiveScan`. | Same | Same | Same |
| Overleaf behavior checks | Current file detection, full snapshot source, file tree write operations, undo checkpoint, Reviewing control, compile capture, save-state verification, OT warm mirror fallback. | Same | Same | Same |
| Last smoke date/result |  |  |  |  |

Documentation signoff:

- README requirements include Git and precise Chrome/Chromium support boundaries.
- README and Chrome Web Store docs list browser IndexedDB `codex-overleaf`, `chrome.storage.local`, `%LOCALAPPDATA%\CodexOverleaf`, `%USERPROFILE%\.codex-overleaf`, `~/.codex-overleaf/projects`, `~/.codex-overleaf/codex-home`, `~/.codex-overleaf/skills`, native logs, and launcher logs.
- FAQ/troubleshooting covers native mismatch, Windows recovery command, Codex CLI missing, extension id mismatch, Linux Chromium, full uninstall/data deletion, diagnostics/logs, stale conflicts, governance blocks, sensitive preflight, and attachments/binary limits.
- Issue templates require OS/browser/native/Codex/Node/install mode/diagnostics export/redaction fields.
- Chrome Web Store privacy, permissions, and listing docs state no default telemetry, redacted diagnostics, and local storage boundaries.

## P0/P1 Signoff

- Run `gh issue list --search 'is:issue is:open (label:P0 OR label:P1)'`.
- Record that no open P0 or P1 issues remain, or stop the release until each issue is closed or explicitly downgraded.

## Scope

Actual Chrome Web Store submission remains a manual store-console step after the
release artifacts pass verification and all v1.1 production-stable gates above are
signed off. Approval is a soft gate: if review rejects the package, fix and
resubmit as a v1.1.1 patch without holding the GitHub Release path.
