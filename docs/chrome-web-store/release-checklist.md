# Chrome Web Store Release Checklist

This checklist is the release gate for the current package version. Keep the
artifact names aligned with `package.json` before running `npm run verify:release`.

## Automated Verification

- Run `npm test`.
- Run `npm run verify:release`.
- Run `npm run build:release`.
- Confirm the GitHub release workflow has a passing macOS, Linux, and Windows test matrix.

## Release Artifact Hygiene

- Verify checksums from `dist/releases/v0.9.5/SHA256SUMS`.
- Inspect extension zip `codex-overleaf-link-extension-v0.9.5.zip` before upload.
- Inspect native host tarball `codex-overleaf-native-host-v0.9.5.tar.gz` before upload.
- Confirm release artifacts exclude `docs/`, `docs/superpowers/`, `.local/`, `.git/`, `test/`, `dist/`, `build/`, README, changelog, roadmap, specs, plans, keys, certificates, logs, sqlite files, and `.crx` files.
- Confirm the release `install.sh` defaults `CODEX_OVERLEAF_REF` to `v0.9.5`.
- Confirm the release `install.ps1` defaults `$DefaultRef` to `v0.9.5`.

## Real Overleaf Smoke

- Install the extension and native host from the built artifacts on a clean browser profile.
- Open a real Overleaf project and confirm panel injection, native bridge compatibility, project snapshot availability, and diagnostics access.
- Record the project URL origin, hashed project id, extension version, native compatibility result, timing notes, and pass/fail status without recording project text, prompts, compile logs, diffs, secrets, or binary data.

### Real Overleaf RC Scenario Matrix

For every row below, record: platform, browser version, extension id/install mode,
native version, Codex CLI version, Overleaf project shape, pass/fail, notes, and
artifact or screenshot reference. Artifacts must not contain project text, prompt
text, compile logs, diffs, binary data, raw secrets, or unredacted project ids.

| # | Scenario | Platform | Browser version | Extension id / install mode | Native version | Codex CLI version | Project shape | Pass/Fail | Notes | Artifact/screenshot |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Install/update native host on macOS Chrome |  |  |  |  |  |  |  |  |  |
| 2 | Install/update native host on Windows Chrome |  |  |  |  |  |  |  |  |  |
| 3 | Install/update native host on Linux Chrome |  |  |  |  |  |  |  |  |  |
| 4 | If Linux Chromium remains claimed, smoke Linux Chromium with `--browser chromium` |  |  |  |  |  |  |  |  |  |
| 5 | Native host missing and native host update-required recovery |  |  |  |  |  |  |  |  |  |
| 6 | Open real Overleaf project and verify panel appears |  |  |  |  |  |  |  |  |  |
| 7 | Ask-only task does not write to Overleaf |  |  |  |  |  |  |  |  |  |
| 8 | Suggest task shows diff and writes only after approval |  |  |  |  |  |  |  |  |  |
| 9 | Auto task writes only when checkpoint or verified Reviewing precondition is met |  |  |  |  |  |  |  |  |  |
| 10 | Undo restores written content |  |  |  |  |  |  |  |  |  |
| 11 | Compile action reports clean/failed compile state |  |  |  |  |  |  |  |  |  |
| 12 | `@file`, `@compile-log`, and `@current-section` context work without leaking content into artifacts |  |  |  |  |  |  |  |  |  |
| 13 | Paste/drop image, PDF, or file as turn-scoped attachment |  |  |  |  |  |  |  |  |  |
| 14 | Binary create/overwrite requires confirmation or reports an explicit unsupported reason |  |  |  |  |  |  |  |  |  |
| 15 | Governance readonly/writable rule blocks the expected write |  |  |  |  |  |  |  |  |  |
| 16 | Sensitive preflight blocks a fake token and does not display the raw secret |  |  |  |  |  |  |  |  |  |
| 17 | Local Codex skills disabled means user/system skills are not visible to the run |  |  |  |  |  |  |  |  |  |
| 18 | Codex Overleaf project skills enabled means project/plugin skill can be used |  |  |  |  |  |  |  |  |  |
| 19 | Stale/collaborator conflict produces an understandable user-facing report |  |  |  |  |  |  |  |  |  |
| 20 | Diagnostics export contains no project text or prompt body |  |  |  |  |  |  |  |  |  |

Recommended smoke command for a logged-in profile:

```bash
npm run smoke:extension -- --url https://www.overleaf.com/project/<project-id> --profile-dir <logged-in-profile> --probe all --json .local/smoke/overleaf-rc.json
```

## Large-Project Performance Baseline

- Run the large-project benchmark for 200+ files, binary assets, long `.tex` files, and repeated sessions.
- Record file counts, byte counts, snapshot timing, native payload size, browser payload size, and any unsupported large-binary writeback results.
- Compare the result to the previous baseline before release signoff.

## Security And Privacy Review

- Review page-bridge spoof resistance, unsafe path rejection, skill-installer containment, native method quotas, diagnostics redaction, and local data documentation.
- Confirm the page-bridge threat model is explicit: same-origin and capability checks reject missing-capability spoof attempts, but the extension does not claim to defend against malicious first-party code already running in the Overleaf page world.
- Confirm diagnostics exports exclude project content, prompt text, compile logs, diffs, binary data, and raw secrets.
- Confirm extension permissions and privacy disclosures match the packaged manifest and runtime behavior.

## Documentation Pass

- Confirm listing copy, privacy notes, and permission notes match the packaged manifest.
- Confirm install, update, uninstall, data-directory, FAQ, troubleshooting, compatibility, and native mismatch docs match the release behavior.
- Capture screenshots, small promo image, and optional marquee image.

## Compatibility Matrix

- Verify install and smoke coverage on macOS, Windows, and Linux.
- Record Chrome version, extension version, native host version, minimum supported native host version, and any platform-specific exceptions.
- Record final Web Store extension id before native-host installer publication.
- Reinstall the native host with that id so `allowed_origins` matches the store extension.

### Documentation And Compatibility Signoff

For each supported row, record the fields below in the release notes or release-candidate artifact bundle. Do not record project text, prompts, compile logs, raw diffs, binary content, raw secrets, or unredacted project ids.

| Field | macOS Chrome | Windows Chrome | Linux Chrome | Linux Chromium |
| --- | --- | --- | --- | --- |
| OS/version/arch |  |  |  |  |
| Browser/channel/version |  |  |  |  |
| Extension install mode | Unpacked / Web Store | Unpacked / Web Store | Unpacked / Web Store | Unpacked / Web Store |
| Extension id |  |  |  |  |
| Installer/update command | `CODEX_OVERLEAF_REF=v0.9.5 bash -c "$(curl -fsSL https://raw.githubusercontent.com/Ghqqqq/codex-overleaf-link/v0.9.5/install.sh)"` | `iwr https://raw.githubusercontent.com/Ghqqqq/codex-overleaf-link/v0.9.5/install.ps1 -OutFile install.ps1`; `$env:CODEX_OVERLEAF_REF='v0.9.5'`; `powershell -ExecutionPolicy Bypass -File install.ps1` | `CODEX_OVERLEAF_REF=v0.9.5 bash -c "$(curl -fsSL https://raw.githubusercontent.com/Ghqqqq/codex-overleaf-link/v0.9.5/install.sh)"` | `CODEX_OVERLEAF_REF=v0.9.5 bash -c "$(curl -fsSL https://raw.githubusercontent.com/Ghqqqq/codex-overleaf-link/v0.9.5/install.sh)" -- --browser chromium` |
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
release artifacts pass verification and all v0.9 release-candidate hardening gates
above are signed off.
