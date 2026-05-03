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

Clone the repository:

```bash
git clone https://github.com/Ghqqqq/codex-overleaf-link.git
cd codex-overleaf-link
```

Install the native host:

```bash
npm run install:native
```

Load the Chrome extension:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the repository's `extension/` directory.
5. Confirm that the extension id is `illdpneeeopfffmiepaejglgmhpmdhdc`.

Open an Overleaf project. The Codex panel should appear on the right side of the page.

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

## Updating

Pull the latest repository changes, reinstall the native host runtime, and reload the Chrome extension:

```bash
git pull
npm run install:native
```

Then open `chrome://extensions`, click reload on **Codex Overleaf Link**, and refresh the Overleaf page.

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

## Current Scope

This is a local macOS/Chrome integration. It is not a Chrome Web Store package, it does not use an Overleaf official API, and browser writeback depends on Overleaf page internals. The implementation favors guarded browser writes, explicit diffs, and local undo checkpoints to reduce the risk of overwriting work.
