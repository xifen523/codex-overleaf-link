<div align="center">
  <img src="extension/assets/icons/codex-overleaf-icon.png" width="128" alt="Codex Overleaf Link logo">
  <h1>Codex Overleaf Link</h1>
  <p><strong>Use local Codex from inside an Overleaf project.</strong></p>
  <p>
    Chrome extension + macOS Native Messaging host that mirrors an Overleaf project to a local Codex workspace,
    streams Codex progress back into Overleaf, and syncs accepted edits back to the browser editor.
  </p>
</div>

## Overview

Codex Overleaf Link is a local bridge for using Codex on Overleaf projects without moving the writing workflow out of Overleaf. It adds a Codex panel to Overleaf, starts Codex locally through a native host, mirrors the current Overleaf project into `~/.codex-overleaf`, and writes accepted local changes back through the Overleaf page.

The project is designed as a glue layer. Codex still runs locally with the user's own Codex account and configuration; the extension only handles Overleaf project capture, local workspace sync, progress streaming, diff review, and browser writeback.

## Features

- Embedded Codex panel on Overleaf project pages.
- Ask-only, suggest-edit, and auto-write task modes.
- Model and reasoning-effort controls in the Overleaf panel.
- Stable per-project local mirror under `~/.codex-overleaf/projects`.
- Local Codex sessions isolated under `~/.codex-overleaf/codex-home` so plugin runs do not pollute global `~/.codex/sessions`.
- Live Codex progress streamed into the panel.
- Per-file diff review before or after writeback, depending on mode.
- Overleaf Reviewing/Track Changes safety check before browser writes.
- Stale-write guard to avoid overwriting user or collaborator changes.
- Undo checkpoint for reversible browser writes.
- Binary assets mirrored locally for LaTeX context while text writeback remains guarded.

## Project Status

Codex Overleaf Link is currently a `0.1.0` community preview for researchers and small teams who are comfortable installing an unpacked Chrome extension and a local native host. The core workflow is usable, but the project is not yet a Chrome Web Store package and should be treated as an unofficial local integration.

## Requirements

- macOS.
- Google Chrome or Chromium with extension Developer Mode enabled.
- Node.js 20 or newer.
- Codex CLI installed and logged in on the same machine.
- An Overleaf account and access to the target project.
- Optional: a TeX distribution such as MacTeX if you want Codex to run `latexmk` or local compile checks.

The current native host installer targets the user-level Chrome Native Messaging directory on macOS:

```text
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.codex.overleaf.json
```

## Quick Start

Run the installer:

```bash
curl -fsSL https://raw.githubusercontent.com/Ghqqqq/codex-overleaf-link/main/install.sh | bash
```

The installer downloads the repository to `~/.codex-overleaf/source`, installs the macOS Native Messaging host, and opens `chrome://extensions`.

Load the Chrome extension:

1. Enable **Developer mode**.
2. Click **Load unpacked**.
3. Select `~/.codex-overleaf/source/extension`.
4. Confirm that the extension id is `illdpneeeopfffmiepaejglgmhpmdhdc`.

Open an Overleaf project. The Codex panel should appear on the right side of the page.

### Manual Install

If you prefer to keep the checkout somewhere else, clone the repository and install the native host manually:

```bash
git clone https://github.com/Ghqqqq/codex-overleaf-link.git
cd codex-overleaf-link
npm run install:native
```

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the repository's `extension/` directory.
5. Confirm that the extension id is `illdpneeeopfffmiepaejglgmhpmdhdc`.

## Extension ID

This repository commits a Chrome extension `key` in `extension/manifest.json`, so unpacked installs should use the stable id:

```text
illdpneeeopfffmiepaejglgmhpmdhdc
```

The native host installer uses that id by default. If Chrome shows a different id, reinstall the native host with the id shown in `chrome://extensions`:

```bash
npm run install:native -- --extension-id <chrome-extension-id>
```

Then reload the extension and refresh the Overleaf project page.

## How It Works

```text
Overleaf page
  -> Chrome content script and page bridge
  -> Chrome extension service worker
  -> macOS Native Messaging host: com.codex.overleaf
  -> local mirror workspace in ~/.codex-overleaf/projects/<project>/workspace
  -> local Codex app-server
  -> sync changes back through the Overleaf page
```

Each task follows this flow:

1. The extension reads a fresh Overleaf project snapshot.
2. The native host syncs that snapshot to a stable local mirror workspace.
3. Codex runs locally against that workspace.
4. The native host collects local text-file changes and attaches diffs.
5. The browser applies accepted changes back to Overleaf with stale-write checks.
6. The extension refreshes the local mirror baseline after successful writeback.

## Local Data

The extension stores local bridge data under `~/.codex-overleaf`:

```text
~/.codex-overleaf/
  codex-home/                 # isolated Codex home for plugin runs
  projects/                   # per-Overleaf-project local mirrors
  native-host-runtime/         # generated native host runtime
  codex-overleaf-bridge        # generated native host launcher
  native-host-debug.log        # bridge debug log
```

`~/.codex-overleaf/codex-home` copies the user's Codex auth/config files and links local skills/plugins/rules, but it keeps plugin-generated Codex sessions separate from global `~/.codex/sessions`.

## Privacy and Security

- Codex runs locally through the user's existing Codex CLI login and account.
- Overleaf project snapshots are mirrored to the local machine under `~/.codex-overleaf/projects`.
- Plugin Codex history is kept under `~/.codex-overleaf/codex-home` instead of the user's global Codex session directory.
- The extension does not send project data to a separate service operated by this repository.
- Browser writeback is guarded by stale-content checks, Reviewing/Track Changes verification when enabled, and local undo checkpoints.

Use the extension only on machines where you are comfortable storing local copies of the relevant Overleaf projects.

## Updating

If you used the quick installer, rerun it to update `~/.codex-overleaf/source` and reinstall the native host runtime:

```bash
curl -fsSL https://raw.githubusercontent.com/Ghqqqq/codex-overleaf-link/main/install.sh | bash
```

Then reload **Codex Overleaf Link** in `chrome://extensions` and refresh the Overleaf page.

If you installed from a manual checkout, pull the latest repository changes, reinstall the native host runtime, and reload the Chrome extension:

```bash
git pull
npm run install:native
```

## Uninstall

Remove the generated native host registration and runtime:

```bash
npm run uninstall:native
```

Then remove the extension from `chrome://extensions`.

The uninstall command does not delete project mirrors or plugin Codex history under `~/.codex-overleaf`. Remove that directory manually only if you no longer need local mirrors, undo context, or plugin history.

## Development

Run the test suite:

```bash
npm test
```

Reinstall the local native host after changing files under `native-host/src`, `extension/src/shared`, or `scripts`:

```bash
npm run install:native
```

Run the native host directly for protocol development:

```bash
npm run bridge
```

Continuous integration runs the same `npm test` command on GitHub Actions for pushes and pull requests.

## Known Limitations

- The project currently supports macOS and Chrome/Chromium only.
- The extension is loaded unpacked through Chrome Developer Mode.
- It is not distributed through the Chrome Web Store.
- It is not affiliated with or endorsed by Overleaf.
- It does not use an official Overleaf API.
- Project capture and browser writeback depend on Overleaf page internals, so Overleaf frontend changes can temporarily break parts of the integration.
- The local native host is required; a Chrome extension alone cannot launch the local Codex process.
- Windows, Linux, Firefox, and hosted/native-less modes are not supported in `0.1.0`.

If Overleaf changes its editor or project tree implementation, run diagnostics from the panel and open an issue with the failing operation, browser version, and project structure.

## Troubleshooting

### Chrome says the native host is missing

Run:

```bash
npm run install:native
```

If your unpacked extension id differs from the stable id in this README, pass it explicitly:

```bash
npm run install:native -- --extension-id <chrome-extension-id>
```

### Codex is not found

Confirm the Codex CLI works in a normal terminal:

```bash
codex --version
```

The native launcher adds common macOS paths and reads the user's login-shell environment. If Codex is installed somewhere unusual, make sure the `codex` command is available from the login shell.

### `latexmk` or TeX tools are not found

Install MacTeX or another TeX distribution and confirm:

```bash
latexmk --version
```

The native launcher includes `/Library/TeX/texbin` in `PATH`.

### Writes are blocked

The extension defaults to guarded write behavior. Enable Reviewing/Track Changes in Overleaf, keep the target file open long enough for Overleaf to load, and rerun the task. If the file changed after Codex started, the stale-write guard will block the write so user or collaborator edits are not overwritten.

### Old plugin sessions appear in VS Code or Codex Desktop

Current versions isolate plugin sessions under `~/.codex-overleaf/codex-home`. Old development builds may have written to global `~/.codex/sessions`; those can be removed by scanning for sessions whose metadata has `originator: "codex-overleaf-link"` or whose `cwd` points into `~/.codex-overleaf/projects`.
