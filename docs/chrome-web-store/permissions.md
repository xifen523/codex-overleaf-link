# Chrome Web Store Permission Notes

## Current Permissions

`nativeMessaging` connects the extension to the local native bridge only. The bridge runs on the user's own macOS, Windows, or Linux machine and is required for local project mirroring, Codex CLI execution, and native diagnostics.

`storage` stores local extension preferences and session UI state, including panel settings, selected model options, project-scoped feature preferences, and task list metadata.

`https://www.overleaf.com/project/*` and `https://overleaf.com/project/*` let the extension inject the panel only on Overleaf project pages, read project snapshots, and write accepted changes back through the browser writeback path.

## Host Permission Scope

No broad host permissions are requested. The extension does not request access to arbitrary websites or all Overleaf pages.
