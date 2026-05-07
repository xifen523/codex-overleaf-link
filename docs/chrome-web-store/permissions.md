# Chrome Web Store Permission Notes

## Current Permissions

`nativeMessaging` connects the extension to the local native bridge only. The bridge runs on the user's own macOS, Windows, or Linux machine and is required for local project mirroring, Codex CLI execution, compatibility checks, and native diagnostics. Native host manifests restrict `allowed_origins` to the installed extension id.

`storage` stores local extension preferences and session UI state in `chrome.storage.local`, including panel settings, selected model options, project-scoped feature preferences, governance rules, skill loading toggles, audit summaries, and task list metadata. Larger local history and diagnostics records use the extension IndexedDB database `codex-overleaf`.

`https://www.overleaf.com/project/*` and `https://overleaf.com/project/*` let the extension inject the panel only on Overleaf project pages, read project snapshots, observe editor/compile state, and write accepted changes back through the guarded browser writeback path.

## Host Permission Scope

No broad host permissions are requested. The extension does not request access to arbitrary websites or all Overleaf pages.

## Web Accessible Resources

The manifest exposes only the packaged icons and extension scripts needed for the Overleaf page bridge and editor adapters on Overleaf origins. It does not expose project mirrors, browser storage, native logs, diagnostics exports, or local files.

## v0.9 Hardening Notes

- The page bridge uses extension-injected scripts for Overleaf project pages only.
- Page-bridge requests require a content-issued capability and same-origin message checks, which blocks missing-capability spoof attempts. This is not a claim to defend against malicious Overleaf first-party code already running in the same page world.
- Mutating writeback paths are guarded by stale checks, governance rules, sensitive preflight, and user confirmation where required.
- Diagnostics and audit summaries are redacted by default and stay local unless the user exports and shares them.
- Linux Chromium requires native registration with `--browser chromium`; macOS Chromium and Windows Chromium are not claimed as supported.
