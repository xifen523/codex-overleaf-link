# Chrome Web Store Listing Draft

## Short Description

Use Codex from inside Overleaf with local project mirroring, guarded browser writeback, diff review, and undo.

## Detailed Description

Codex Overleaf Link connects an Overleaf project page to a local Codex bridge on macOS, Windows, or Linux. The extension injects a focused panel into Overleaf project pages, mirrors the active project into a local Codex Overleaf workspace, runs Codex through the user's local Codex CLI account, and writes accepted changes back through the browser with freshness checks and undo support.

The extension is designed for explicit, local control. It has no hosted backend, no default telemetry, uses Chrome Native Messaging for the local bridge, and scopes host permissions to Overleaf project pages.

Supported browser targets are Google Chrome on macOS, Windows, and Linux. Linux Chromium can be used when the native host is installed with `--browser chromium`; macOS Chromium and Windows Chromium are not claimed as supported.

## Feature Bullets

- Ask, suggest-edit, and auto-write task modes.
- Local project mirror for Codex CLI runs.
- Diff review before accepting suggested changes.
- Stale-write guards and undo checkpoints for browser writeback.
- Optional Overleaf Reviewing and compile integration.
- Project governance rules and sensitive preflight checks.
- Turn-scoped composer attachments with documented limits.
- Local project/plugin skills without reusing global Codex sessions.
- Redacted compatibility diagnostics for missing or outdated native hosts.

## Privacy Summary

- No hosted backend or default telemetry.
- Browser data stays in extension IndexedDB `codex-overleaf` and `chrome.storage.local`.
- Native runtime, logs, mirrors, plugin Codex home, and skills stay in documented local directories.
- Diagnostics exports are intended to exclude project text, prompt bodies, compile logs, raw diffs, binary content, and raw secrets by default.

## Support

Support and issue URL: https://github.com/Ghqqqq/codex-overleaf-link/issues

## Asset Checklist

- Existing 128 icon: `extension/assets/icons/icon128.png`.
- Screenshots showing the panel in an Overleaf project, diff review, and native diagnostics.
- Small promo image.
- Optional marquee image.
