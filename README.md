# Codex Overleaf Link

Initial Chrome/macOS prototype for linking an active Overleaf project to a local Codex bridge.

## What Works in This Version

- Chrome/Chromium Manifest V3 extension.
- Overleaf embedded Codex panel plus browser popup entry.
- macOS Native Messaging host registration.
- Native bridge protocol with `bridge.ping` and `task.run`.
- Confirm Mode and Auto Mode task routing.
- Auto Mode checkpoint requirement and Confirm fallback.
- Summary-only task confirmation and summarized Delete Plan handling.
- Page bridge adapter for active-editor reads and best-effort editor writes.

## Current Limits

- Full-project Overleaf file capture depends on private Overleaf page internals. The first adapter captures the active editor and includes best-effort file-tree hooks for multi-file edits and file operations.
- Checkpoint creation is best-effort through detected Overleaf history objects. If unavailable, Auto Mode falls back to Confirm Mode.
- Real Codex execution is connected through `CODEX_OVERLEAF_AGENT_CMD`. Without it, the bridge returns structured no-op task results so the extension-to-host pipe can be tested.

## Install for Local Development

1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Load unpacked extension from `extension/`.
4. Copy the generated extension id.
5. Register the native host:

```bash
npm run install:native -- --extension-id <chrome-extension-id>
```

6. Open an Overleaf project and use the extension popup to open the Codex panel.

## Optional Agent Command

Set `CODEX_OVERLEAF_AGENT_CMD` to a command that reads a task request JSON from stdin and writes a result JSON to stdout. A Codex CLI wrapper is included:

```bash
export CODEX_OVERLEAF_AGENT_CMD="node /absolute/path/to/codex-overleaf-link/scripts/codex-json-agent.mjs"
```

The command returns operation JSON such as:

```json
{
  "status": "requires_task_confirmation",
  "operations": [
    {
      "type": "edit",
      "path": "active.tex",
      "find": "old",
      "replace": "new"
    }
  ]
}
```

For Auto Mode, the bridge refuses to run unless the page bridge reports a successful Overleaf checkpoint.

## Test

```bash
npm test
```
