<div align="center">
  <img src="extension/assets/icons/codex-overleaf-icon.png" width="96" alt="Codex Overleaf Link">
  <h1>Codex Overleaf Link</h1>
  <p><strong>Empower Overleaf with Codex.</strong></p>
  <p>
    <img src="https://img.shields.io/badge/version-1.1.0-blue" alt="version">
    <img src="https://img.shields.io/badge/platform-macOS%20%2F%20Windows%20%2F%20Linux-lightgrey" alt="platform">
    <img src="https://img.shields.io/badge/chrome-MV3-green" alt="chrome manifest v3">
    <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="node version">
    <a href="https://github.com/Ghqqqq/codex-overleaf-link/actions/workflows/test.yml"><img src="https://github.com/Ghqqqq/codex-overleaf-link/actions/workflows/test.yml/badge.svg" alt="tests"></a>
    <img src="https://img.shields.io/badge/dependencies-0-orange" alt="zero dependencies">
    <img src="https://img.shields.io/badge/license-MIT-blue" alt="license">
  </p>
</div>

---

## Why

Overleaf is great for collaborative LaTeX writing. Codex is great for AI-assisted editing. But switching between them breaks flow — you lose Overleaf's real-time collaboration, or you lose Codex's local intelligence.

Codex Overleaf Link bridges the two: it adds a Codex panel directly inside Overleaf, mirrors the project locally for Codex to work on, and writes accepted changes back through the browser — with stale-write guards, diff review, and undo checkpoints to reduce the risk of accidental overwrites.

## Preview

<p align="center">
  <img src="assets/codex-preview.png" alt="Codex Overleaf Link running inside Overleaf">
</p>

## Install

macOS / Linux latest source install:

```bash
curl -fsSL "https://raw.githubusercontent.com/Ghqqqq/codex-overleaf-link/main/install.sh?$(date +%s)" | bash
```

macOS / Linux version-pinned install or update for v1.1.0:

```bash
CODEX_OVERLEAF_REF=v1.1.0 bash -c "$(curl -fsSL https://raw.githubusercontent.com/Ghqqqq/codex-overleaf-link/v1.1.0/install.sh)"
```

Windows version-pinned install or update for v1.1.0 from PowerShell:

```powershell
iwr https://raw.githubusercontent.com/Ghqqqq/codex-overleaf-link/v1.1.0/install.ps1 -OutFile install.ps1
$env:CODEX_OVERLEAF_REF='v1.1.0'
powershell -ExecutionPolicy Bypass -File install.ps1
```

The macOS / Linux installer creates a visible `~/Codex Overleaf Link Extension` shortcut to the extension folder. On macOS it also opens Chrome's extension page, opens Finder to the shortcut, and copies the shortcut path. The Windows installer prints the extension folder path after registering the native host.
Chrome still requires one manual approval step for unpacked extensions:

1. Enable **Developer mode** in `chrome://extensions`.
2. Click **Load unpacked** and select `~/Codex Overleaf Link Extension`.

## npm Native Host CLI

npm installs/updates/uninstalls/diagnoses the native host only. npm does not install the Chrome extension; install the Chrome extension separately from a release zip, an unpacked checkout, or the Chrome Web Store once published.

Install or update the native host for a dev/unpacked extension id:

```bash
npm exec --yes codex-overleaf-link@1.1.0 -- install-native --extension-id <chrome-extension-id>
```

Diagnose the registered native host:

```bash
npm exec --yes codex-overleaf-link@1.1.0 -- doctor
```

Uninstall the native host:

```bash
npm exec --yes codex-overleaf-link@1.1.0 -- uninstall-native
```

Use `--extension-id` for dev/unpacked extension ids so the Native Messaging manifest allows the actual Chrome extension id assigned on your machine. Do not document a default Chrome Web Store id unless a safe default is committed.

Open any Overleaf project — the Codex panel appears on the right.

## Quick Start

1. Run the installer for your platform, or use the version-pinned v1.1.0 command when you want deterministic install/update behavior.
2. In `chrome://extensions`, enable Developer mode, load or reload the unpacked extension folder, and confirm the native host is connected from the panel diagnostics.
3. Open an Overleaf project and start in Ask mode; switch to Suggest mode when you want Codex to propose reviewed edits, or Auto mode when the project governance and checkpoint settings are ready for direct writeback.

<p align="center">
  <img src="assets/codex-preview.png" alt="Codex Overleaf Link panel inside Overleaf">
</p>

<details>
<summary><strong>Manual install</strong> (if you prefer a custom location)</summary>

```bash
git clone https://github.com/Ghqqqq/codex-overleaf-link.git
cd codex-overleaf-link
npm run install:native
```

Then load `extension/` as an unpacked extension in Chrome and run `npm run install:native` again if Chrome assigns a different extension id.

</details>

<details>
<summary><strong>Update</strong></summary>

For a deterministic v1.1.0 update, run the pinned command for your platform. This is also the native mismatch recovery command shown by the popup and panel when they report **Native host update required**.

macOS / Linux:

```bash
CODEX_OVERLEAF_REF=v1.1.0 bash -c "$(curl -fsSL https://raw.githubusercontent.com/Ghqqqq/codex-overleaf-link/v1.1.0/install.sh)"
```

Windows PowerShell:

```powershell
iwr https://raw.githubusercontent.com/Ghqqqq/codex-overleaf-link/v1.1.0/install.ps1 -OutFile install.ps1
$env:CODEX_OVERLEAF_REF='v1.1.0'
powershell -ExecutionPolicy Bypass -File install.ps1
```

Then reload the extension in `chrome://extensions` and refresh the Overleaf page.

</details>

## GitHub Release Artifacts

The v1.1.0 GitHub Release contains:

- `codex-overleaf-link-extension-v1.1.0.zip`: loadable Chrome extension package for unpacked or Web Store inspection.
- `codex-overleaf-native-host-v1.1.0.tar.gz`: native host runtime files used by the installer and release verification.
- `codex-overleaf-link-1.1.0.tgz`: npm native host CLI package for pinned install, doctor, and uninstall flows.
- `install.sh`: release-pinned macOS / Linux installer that defaults to `v1.1.0` when run directly from the release artifact.
- `install.ps1`: release-pinned Windows PowerShell installer that defaults to `v1.1.0` when run directly from the release artifact.
- `uninstall-native-host.mjs`: native host uninstaller that removes the Chrome Native Messaging manifest, bridge executable, and runtime copy.
- `SHA256SUMS` and `release-manifest.json`: checksum and artifact metadata for release verification.

<details>
<summary><strong>Uninstall</strong></summary>

macOS / Linux:

```bash
node ~/.codex-overleaf/source/scripts/uninstall-native-host.mjs
```

Windows PowerShell:

```powershell
node $env:LOCALAPPDATA\CodexOverleaf\source\scripts\uninstall-native-host.mjs
```

If you installed from a manual checkout, you can also run `npm run uninstall:native` inside the repo.

Remove the extension from `chrome://extensions`. Optionally delete `~/.codex-overleaf` on macOS / Linux to remove local mirrors, native runtime files, and plugin history. On Windows, `%LOCALAPPDATA%\CodexOverleaf` contains the native source, runtime, bridge, and native log, while `%USERPROFILE%\.codex-overleaf` contains project mirrors, plugin Codex home/history, and Codex Overleaf skills. Full Windows cleanup requires deleting both roots, or following [Local Data And Cleanup](#local-data-and-cleanup).

The uninstaller removes the Native Messaging registration, bridge executable, and native runtime copy. It does not remove browser IndexedDB, `chrome.storage.local`, project mirrors, plugin Codex history, or project/plugin skills. See [Local Data And Cleanup](#local-data-and-cleanup) for full deletion steps.

</details>

## Requirements

| Requirement | Notes |
|-------------|-------|
| macOS / Windows / Linux | Native Messaging host targets the current user's browser registration location |
| Chrome / Chromium | macOS Chrome, Windows Chrome, and Linux Chrome are supported. Linux Chromium is supported only when installed with `--browser chromium`. macOS Chromium and Windows Chromium are not claimed as supported yet. |
| Node.js >= 20 | Powers the native host bridge |
| Git | Required by the one-command source installers and manual checkout flow |
| Codex CLI | Installed and logged in (`codex --version` to verify) |
| Overleaf account | Access to the target project |
| TeX distribution *(optional)* | For `latexmk` / local compile checks |

## Browser Support

| Platform | Supported browser path | Notes |
|----------|------------------------|-------|
| macOS | Google Chrome | Use the default installer. macOS Chromium native registration is not documented as supported. |
| Windows | Google Chrome | Use the PowerShell installer. Windows Chromium native registration is not documented as supported. |
| Linux | Google Chrome | Use the default installer. |
| Linux | Chromium | Pass `--browser chromium` to install or uninstall the native host. |

Linux Chromium install or update:

```bash
CODEX_OVERLEAF_REF=v1.1.0 bash -c "$(curl -fsSL https://raw.githubusercontent.com/Ghqqqq/codex-overleaf-link/v1.1.0/install.sh)" -- --browser chromium
```

Linux Chromium uninstall:

```bash
node ~/.codex-overleaf/source/scripts/uninstall-native-host.mjs --browser chromium
```

## Features

- **Three task modes** — ask-only, suggest-edit (review before write), auto-write (with delete confirmation).
- **Live progress** — Codex events stream into the panel in real time.
- **Stale-write guard** — blocks writes if the file changed since Codex started.
- **Diff review** — per-file diff view before accepting changes.
- **Undo checkpoint** — one-click revert of browser writes.
- **Track Changes integration** — optionally enables Overleaf Reviewing before writing.
- **Auto-recompile** — triggers Overleaf recompile after writeback; logs compile errors as context.
- **@ context** — attach specific files, `@compile-log`, or `@current-section` to the prompt.
- **Composer attachments and binary writeback** — paste or drop PDFs, images, and files into the composer as turn-scoped Codex context, and review Codex-created assets before creating or replacing them in Overleaf.
- **Codex Overleaf skills** — install reusable plugin-scoped skills through the slash menu, then let Codex auto-trigger them or select one explicitly for the next turn.
- **Governance rules** — configure project read-only and writable path rules that block unsafe writeback before browser mutation.
- **Sensitive preflight** — scan selected project context for likely secrets before sending it to Codex.
- **Audit and diagnostics** — keep local run records and export redacted diagnostic bundles for issue reports.
- **Model picker** — discover available Codex models locally, then switch model, reasoning effort, and speed from one compact control.
- **Session history** — multi-session management with rename, resume, and delete.
- **Isolated Codex home** — plugin sessions stay under `~/.codex-overleaf/codex-home`, not global `~/.codex/sessions`.
- **Experimental OT warm mirror** - optional read-only observation of active Overleaf text edits to keep focused local mirror files warm. Falls back to full snapshots when unavailable or inconsistent.

> Note: The OT warm mirror is experimental, off by default, and never writes back to Overleaf through realtime collaboration channels.

## Common Workflows

- **Fix a compile error** - choose Suggest mode, attach `@compile-log`, ask Codex to diagnose and patch the failing file, review the diff, apply it, then recompile from the panel.
- **Rewrite a paragraph** - select the target file or `@current-section`, ask for a tone or clarity rewrite in Suggest mode, review the text diff, and accept only the hunks you want.
- **Translate a section** - attach the source section with `@file` or `@current-section`, specify the target language and terminology constraints, then review the proposed replacement before writeback.

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│  Overleaf page                                              │
│    ↕ page bridge (injected script)                          │
├─────────────────────────────────────────────────────────────┤
│  Chrome content script                                      │
│    ↕ chrome.runtime messaging                               │
├─────────────────────────────────────────────────────────────┤
│  Extension service worker                                   │
│    ↕ Native Messaging (stdio)                               │
├─────────────────────────────────────────────────────────────┤
│  Native host (Node.js)                                      │
│    → mirror sync: per-user Codex Overleaf local workspace    │
│    → Codex CLI session                                      │
│    ← collect diffs + patches                                │
├─────────────────────────────────────────────────────────────┤
│  Browser writeback (with stale-write guard + undo)          │
└─────────────────────────────────────────────────────────────┘
```

**Task lifecycle:**

1. Extension captures a project snapshot from Overleaf.
2. Native host syncs the snapshot to a local mirror workspace.
3. Codex runs against the workspace.
4. Native host collects text changes and computes diffs/patches.
5. Extension applies changes back to Overleaf with freshness verification.
6. Mirror baseline is updated after successful writeback.

## Extension ID

This repo ships a stable Chrome extension `key`, producing the deterministic id:

```
illdpneeeopfffmiepaejglgmhpmdhdc
```

If Chrome assigns a different id, reinstall the native host with the actual id.

macOS / Linux:

```bash
cd ~/.codex-overleaf/source && npm run install:native -- --extension-id <your-chrome-extension-id>
```

Windows PowerShell:

```powershell
cd $env:LOCALAPPDATA\CodexOverleaf\source
npm run install:native -- --extension-id <your-chrome-extension-id>
```

For Chrome Web Store builds, record the final Web Store extension id before publishing the native-host installer guidance. Pass that id with `CODEX_OVERLEAF_EXTENSION_ID=<web-store-extension-id>` when running `install.sh`, or with `--extension-id <web-store-extension-id>` when running `scripts/install-native-host.mjs`, so the native manifest `allowed_origins` entry matches the installed extension.

## Local Data And Cleanup

Codex Overleaf Link does not use a hosted backend or default telemetry. Data is local to the Chrome profile and local native host. The static privacy policy for Chrome Web Store review is published from `docs/privacy-policy.html`.

| Area | Location | Contents |
|------|----------|----------|
| Browser IndexedDB | Extension database `codex-overleaf` | Sessions, turns, events, artifacts, and audit logs. |
| Browser extension storage | `chrome.storage.local` | Preferences, project settings, governance rules, selected skill ids, and panel state. |
| macOS/Linux source checkout | `~/.codex-overleaf/source` | Installer-managed source tree used by pinned updates and uninstall commands. |
| macOS/Linux native runtime | `~/.codex-overleaf/native-host-runtime` | Runtime copy loaded by Chrome Native Messaging. |
| macOS/Linux bridge | `~/.codex-overleaf/codex-overleaf-bridge` | Native Messaging launcher executable. |
| Windows source/runtime/bridge | `%LOCALAPPDATA%\CodexOverleaf` | `source`, `native-host-runtime`, `codex-overleaf-bridge.cmd`, and native debug log. |
| Project mirrors | `~/.codex-overleaf/projects` on macOS/Linux, `%USERPROFILE%\.codex-overleaf\projects` on Windows | Local mirror workspaces and mirror metadata for each Overleaf project. |
| Plugin Codex home | `~/.codex-overleaf/codex-home` on macOS/Linux, `%USERPROFILE%\.codex-overleaf\codex-home` on Windows | Isolated Codex home for plugin runs. It copies auth/config metadata but does not reuse global Codex sessions. |
| Codex Overleaf skills | `~/.codex-overleaf/skills` on macOS/Linux, `%USERPROFILE%\.codex-overleaf\skills` on Windows | Project/plugin skills managed by the extension. |
| Native logs | `~/.codex-overleaf/native-host.log` on macOS/Linux, `%LOCALAPPDATA%\CodexOverleaf\native-host.log` on Windows | Native debug events with content length summaries where possible. |
| Launcher logs | `~/.codex-overleaf/native-host-launcher.log` on macOS/Linux | POSIX launcher startup path and Node diagnostics. The Windows `.cmd` launcher does not currently emit a separate launcher log. |

Skill loading toggles default to enabled. In Project Settings:

- `Load local Codex skills` loads the user's local Codex skill environment from the global Codex home into the isolated `~/.codex-overleaf/codex-home`: `~/.codex/skills`, local Codex `plugins`, `superpowers`, and related skill/plugin configuration. Turning it off hides user/system Codex skills and local Codex plugins from Codex Overleaf runs. This affects only the plugin CODEX_HOME prepared for the run; it does not write to or reuse global `~/.codex/sessions`.
- `Load Codex Overleaf skills` loads project/plugin skills managed by the extension from `~/.codex-overleaf/skills` on macOS/Linux or `%USERPROFILE%\.codex-overleaf\skills` on Windows into the same isolated Codex home. Turning it off hides those extension-managed skills while preserving the stored skill files. If both toggles are off, the run starts without local Codex skills or Codex Overleaf skills.

Native registration paths:

| Platform/browser | Registration path |
|------------------|-------------------|
| macOS Chrome | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.codex.overleaf.json` |
| Linux Chrome | `~/.config/google-chrome/NativeMessagingHosts/com.codex.overleaf.json` |
| Linux Chromium | `~/.config/chromium/NativeMessagingHosts/com.codex.overleaf.json` |
| Windows Chrome | `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.codex.overleaf`, pointing to `%LOCALAPPDATA%\CodexOverleaf\native-host-runtime\com.codex.overleaf.json` |

Full uninstall and data deletion:

1. Remove the extension from `chrome://extensions` in every Chrome/Chromium profile where it was loaded. This removes the extension's `codex-overleaf` IndexedDB and `chrome.storage.local` data for that profile.
2. Run the native uninstaller for the browser you registered. Use `--browser chromium` on Linux Chromium.
3. Delete local native and mirror data if you want a clean machine:
   - macOS/Linux: `rm -rf ~/.codex-overleaf ~/Codex\ Overleaf\ Link\ Extension`
   - Windows PowerShell: `Remove-Item -Recurse -Force "$env:LOCALAPPDATA\CodexOverleaf", "$env:USERPROFILE\.codex-overleaf" -ErrorAction SilentlyContinue`

Composer attachments are turn-scoped Codex context. Limits are 8 attachments per run and 12 MiB per attachment. Attachments are staged under `.codex-overleaf-attachments` inside the mirror workspace and are ignored during writeback.

## FAQ And Troubleshooting

**Native host missing or update required**

Run the pinned installer for your platform, reload the extension in `chrome://extensions`, then refresh the Overleaf tab. This also fixes extension/native version mismatch and native protocol mismatch.

macOS/Linux:

```bash
CODEX_OVERLEAF_REF=v1.1.0 bash -c "$(curl -fsSL https://raw.githubusercontent.com/Ghqqqq/codex-overleaf-link/v1.1.0/install.sh)"
```

Windows PowerShell:

```powershell
iwr https://raw.githubusercontent.com/Ghqqqq/codex-overleaf-link/v1.1.0/install.ps1 -OutFile install.ps1
$env:CODEX_OVERLEAF_REF='v1.1.0'
powershell -ExecutionPolicy Bypass -File install.ps1
```

**The Windows popup or panel shows a Bash recovery command**

Use the PowerShell recovery command above on Windows. The Bash command is for macOS/Linux installers.

**Codex CLI not found**

Confirm `codex --version` works in a new terminal and that you are logged in. On macOS/Linux, reinstalling the native host regenerates the launcher after PATH changes. On Windows, confirm `Get-Command codex` succeeds in PowerShell before reinstalling.

**Extension id mismatch**

The bundled key should produce `illdpneeeopfffmiepaejglgmhpmdhdc`. If Chrome assigns a different id, reinstall the native host with that id:

```bash
cd ~/.codex-overleaf/source && npm run install:native -- --extension-id <your-chrome-extension-id>
```

```powershell
cd $env:LOCALAPPDATA\CodexOverleaf\source
npm run install:native -- --extension-id <your-chrome-extension-id>
```

**Linux Chromium does not connect**

Reinstall the native host with `--browser chromium`, reload the unpacked extension, and refresh Overleaf. The Chromium manifest path is different from Chrome's path.

**Diagnostics and logs**

Use the diagnostics export for issue reports. Diagnostics are intended to exclude project text, prompt bodies, compile logs, raw diffs, binary content, and raw secrets by default. If you manually attach logs, review and redact file names, project ids, tokens, prompts, and document text.

**Stale collaborator conflict**

The stale-write guard blocks writes when the Overleaf file changed since Codex started. Review collaborator edits, refresh the page or rerun the task from a fresh snapshot, then apply the diff again.

**Governance blocked write**

Project governance rules can mark paths read-only or restrict writable paths. Switch to ask-only mode, adjust the project governance settings, or narrow the requested edit to an allowed path.

**Sensitive preflight warning**

Sensitive preflight scans selected context for likely tokens or secrets before a Codex run. Remove the sensitive text from selected context, redact it, or explicitly decide not to send that context.

**Attachments and binary limits**

Attachments are for turn-scoped context and are not written back to Overleaf. Binary create/overwrite is reviewed separately. Large binary writeback may be reported as unsupported instead of being inlined when it would exceed native messaging payload limits.

## Compatibility Matrix

Use this matrix for release-candidate signoff and compatibility reports. Record exact versions from the machine under test before publishing release guidance.

| Field | macOS Chrome | Windows Chrome | Linux Chrome | Linux Chromium |
|-------|--------------|----------------|--------------|----------------|
| OS/version/arch | Record exact macOS version and `arm64`/`x64`. | Record exact Windows version and `arm64`/`x64`. | Record distro, version, and `arm64`/`x64`. | Record distro, version, and `arm64`/`x64`. |
| Browser/channel/version | Google Chrome channel and version. | Google Chrome channel and version. | Google Chrome channel and version. | Chromium channel/package and version. |
| Install mode | Unpacked extension or Web Store id once published. | Unpacked extension or Web Store id once published. | Unpacked extension or Web Store id once published. | Unpacked extension or Web Store id once published; native host installed with `--browser chromium`. |
| Extension id | Default unpacked id `illdpneeeopfffmiepaejglgmhpmdhdc`, or recorded Web Store id. | Default unpacked id `illdpneeeopfffmiepaejglgmhpmdhdc`, or recorded Web Store id. | Default unpacked id `illdpneeeopfffmiepaejglgmhpmdhdc`, or recorded Web Store id. | Default unpacked id `illdpneeeopfffmiepaejglgmhpmdhdc`, or recorded Web Store id. |
| Installer/update command | `CODEX_OVERLEAF_REF=v1.1.0 bash -c "$(curl -fsSL https://raw.githubusercontent.com/Ghqqqq/codex-overleaf-link/v1.1.0/install.sh)"` | `iwr https://raw.githubusercontent.com/Ghqqqq/codex-overleaf-link/v1.1.0/install.ps1 -OutFile install.ps1`; `$env:CODEX_OVERLEAF_REF='v1.1.0'`; then `powershell -ExecutionPolicy Bypass -File install.ps1` | `CODEX_OVERLEAF_REF=v1.1.0 bash -c "$(curl -fsSL https://raw.githubusercontent.com/Ghqqqq/codex-overleaf-link/v1.1.0/install.sh)"` | `CODEX_OVERLEAF_REF=v1.1.0 bash -c "$(curl -fsSL https://raw.githubusercontent.com/Ghqqqq/codex-overleaf-link/v1.1.0/install.sh)" -- --browser chromium` |
| Uninstall command | `node ~/.codex-overleaf/source/scripts/uninstall-native-host.mjs` | `node $env:LOCALAPPDATA\CodexOverleaf\source\scripts\uninstall-native-host.mjs` | `node ~/.codex-overleaf/source/scripts/uninstall-native-host.mjs` | `node ~/.codex-overleaf/source/scripts/uninstall-native-host.mjs --browser chromium` |
| Manifest/registry path | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.codex.overleaf.json` | `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.codex.overleaf` -> `%LOCALAPPDATA%\CodexOverleaf\native-host-runtime\com.codex.overleaf.json` | `~/.config/google-chrome/NativeMessagingHosts/com.codex.overleaf.json` | `~/.config/chromium/NativeMessagingHosts/com.codex.overleaf.json` |
| Bridge/runtime/source path | Bridge `~/.codex-overleaf/codex-overleaf-bridge`; runtime `~/.codex-overleaf/native-host-runtime`; source `~/.codex-overleaf/source`. | Bridge `%LOCALAPPDATA%\CodexOverleaf\codex-overleaf-bridge.cmd`; runtime `%LOCALAPPDATA%\CodexOverleaf\native-host-runtime`; source `%LOCALAPPDATA%\CodexOverleaf\source`. | Bridge `~/.codex-overleaf/codex-overleaf-bridge`; runtime `~/.codex-overleaf/native-host-runtime`; source `~/.codex-overleaf/source`. | Bridge `~/.codex-overleaf/codex-overleaf-bridge`; runtime `~/.codex-overleaf/native-host-runtime`; source `~/.codex-overleaf/source`. |
| Node/Git/Codex/TeX | Node.js >= 20; Git; Codex CLI installed and logged in; TeX optional. | Node.js >= 20; Git; Codex CLI installed and logged in; TeX optional. | Node.js >= 20; Git; Codex CLI installed and logged in; TeX optional. | Node.js >= 20; Git; Codex CLI installed and logged in; TeX optional. |
| Native protocol/capabilities | Protocol 1; native protocol range 1-1; requires `bridgePing`, `mirrorSync`, `mirrorPatchFiles`, `mirrorStatus`, `codexRun`, `codexCancel`, `codexModels`, `historyClearPlugin`, `localSkills`, `mirrorSensitiveScan`. | Same as macOS Chrome. | Same as macOS Chrome. | Same as macOS Chrome. |
| Overleaf behavior checks | Current file detection, full snapshot source, file tree write operations, undo checkpoint, Reviewing control, compile capture, save-state verification, OT warm mirror fallback. | Same checks. | Same checks. | Same checks. |
| Last smoke date/result | Record date, tester, and pass/fail. | Record date, tester, and pass/fail. | Record date, tester, and pass/fail. | Record date, tester, and pass/fail. |

## Development

```bash
npm test                 # Node.js built-in test runner, zero dependencies
npm run check:architecture # enforce v1.0 final architecture budgets
npm run benchmark:large    # run the synthetic large-project regression gate
npm run bridge           # run the native host directly for protocol work
npm run install:native  # reinstall native host after changing native-host/src or extension/src/shared
```

## Contributing

Contributions are welcome. Please open an issue before submitting large changes so we can discuss the approach.

1. Fork the repository.
2. Create a feature branch.
3. Run `npm test` and ensure all tests pass.
4. Submit a pull request with a clear description.

## License

[MIT](LICENSE)
