<div align="center">
  <img src="extension/assets/icons/codex-overleaf-icon.png" width="96" alt="Codex Overleaf Link">
  <h1>Codex Overleaf Link</h1>
  <p><strong>Empower Overleaf with Codex.</strong></p>
  <p>
    <img src="https://img.shields.io/badge/version-0.8.0-blue" alt="version">
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

macOS / Linux version-pinned install or update for v0.8.0:

```bash
CODEX_OVERLEAF_REF=v0.8.0 bash -c "$(curl -fsSL https://raw.githubusercontent.com/Ghqqqq/codex-overleaf-link/v0.8.0/install.sh)"
```

Windows version-pinned install or update for v0.8.0 from PowerShell:

```powershell
iwr https://raw.githubusercontent.com/Ghqqqq/codex-overleaf-link/v0.8.0/install.ps1 -OutFile install.ps1
powershell -ExecutionPolicy Bypass -File install.ps1
```

The macOS / Linux installer creates a visible `~/Codex Overleaf Link Extension` shortcut to the extension folder. On macOS it also opens Chrome's extension page, opens Finder to the shortcut, and copies the shortcut path. The Windows installer prints the extension folder path after registering the native host.
Chrome still requires one manual approval step for unpacked extensions:

1. Enable **Developer mode** in `chrome://extensions`.
2. Click **Load unpacked** and select `~/Codex Overleaf Link Extension`.

Open any Overleaf project — the Codex panel appears on the right.

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

For a deterministic v0.8.0 update, run the pinned command for your platform. This is also the native mismatch recovery command shown by the popup and panel when they report **Native host update required**.

macOS / Linux:

```bash
CODEX_OVERLEAF_REF=v0.8.0 bash -c "$(curl -fsSL https://raw.githubusercontent.com/Ghqqqq/codex-overleaf-link/v0.8.0/install.sh)"
```

Windows PowerShell:

```powershell
iwr https://raw.githubusercontent.com/Ghqqqq/codex-overleaf-link/v0.8.0/install.ps1 -OutFile install.ps1
powershell -ExecutionPolicy Bypass -File install.ps1
```

Then reload the extension in `chrome://extensions` and refresh the Overleaf page.

</details>

## GitHub Release Artifacts

The v0.8.0 GitHub Release contains:

- `codex-overleaf-link-extension-v0.8.0.zip`: loadable Chrome extension package for unpacked or Web Store inspection.
- `codex-overleaf-native-host-v0.8.0.tar.gz`: native host runtime files used by the installer and release verification.
- `install.sh`: release-pinned macOS / Linux installer that defaults to `v0.8.0` when run directly from the release artifact.
- `install.ps1`: release-pinned Windows PowerShell installer that defaults to `v0.8.0` when run directly from the release artifact.
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

Remove the extension from `chrome://extensions`. Optionally delete `~/.codex-overleaf` on macOS / Linux or `$env:LOCALAPPDATA\CodexOverleaf` on Windows to remove local mirrors, native runtime files, and plugin history.

</details>

## Requirements

| Requirement | Notes |
|-------------|-------|
| macOS / Windows / Linux | Native Messaging host targets the current user's Chrome / Chromium registration location |
| Chrome / Chromium | Developer mode enabled for unpacked extension |
| Node.js >= 20 | Powers the native host bridge |
| Codex CLI | Installed and logged in (`codex --version` to verify) |
| Overleaf account | Access to the target project |
| TeX distribution *(optional)* | For `latexmk` / local compile checks |

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
- **Project-local skills** — install, enable, and remove project-scoped Markdown skills that are injected into Codex runs without modifying global Codex settings.
- **Governance rules** — configure project read-only and writable path rules that block unsafe writeback before browser mutation.
- **Sensitive preflight** — scan selected project context for likely secrets before sending it to Codex.
- **Audit and diagnostics** — keep local run records and export redacted diagnostic bundles for issue reports.
- **Model picker** — discover available Codex models locally, then switch model, reasoning effort, and speed from one compact control.
- **Session history** — multi-session management with rename, resume, and delete.
- **Isolated Codex home** — plugin sessions stay under `~/.codex-overleaf/codex-home`, not global `~/.codex/sessions`.
- **Experimental OT warm mirror** - optional read-only observation of active Overleaf text edits to keep focused local mirror files warm. Falls back to full snapshots when unavailable or inconsistent.

> Note: The OT warm mirror is experimental, off by default, and never writes back to Overleaf through realtime collaboration channels.

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

## Development

```bash
npm test              # Node.js built-in test runner, zero dependencies
npm run bridge        # run the native host directly for protocol work
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
