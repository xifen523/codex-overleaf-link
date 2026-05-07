# Chrome Web Store Privacy Notes

## Data Flow

Codex Overleaf Link adds no hosted backend, telemetry service, hosted relay, or remote audit store. The extension talks to a local Chrome Native Messaging host, and the native host talks to the user's configured local Codex CLI account.

Project snapshots are mirrored locally so Codex can work against files on the user's machine. Browser and native storage boundaries are:

- Browser IndexedDB database `codex-overleaf`: sessions, turns, events, artifacts, and audit logs.
- `chrome.storage.local`: preferences, project settings, governance rules, selected skill ids, and panel state.
- Project mirrors: `~/.codex-overleaf/projects` on macOS/Linux and `%USERPROFILE%\.codex-overleaf\projects` on Windows.
- Plugin-isolated Codex home: `~/.codex-overleaf/codex-home` on macOS/Linux and `%USERPROFILE%\.codex-overleaf\codex-home` on Windows. This keeps plugin sessions separate from global Codex sessions.
- Codex Overleaf skills: `~/.codex-overleaf/skills` on macOS/Linux and `%USERPROFILE%\.codex-overleaf\skills` on Windows.
- Native runtime/source/logs: `~/.codex-overleaf` on macOS/Linux where applicable, and `%LOCALAPPDATA%\CodexOverleaf` on Windows.

Composer attachments are turn-scoped context. They are staged under `.codex-overleaf-attachments` inside the local mirror workspace, are capped before being sent to the native host, and are ignored during writeback.

## Processing

Codex processing uses the user's configured local Codex CLI account. The project does not add a service account or separate cloud account. Any content sent to Codex is controlled by the user's selected task, context, attachment, and skill settings.

The Overleaf page bridge runs inside Overleaf project pages so it can read editor state and apply accepted browser writebacks. Bridge messages are same-origin checked and capability gated to reject missing-capability spoof attempts, but the page bridge treats first-party code already running in the Overleaf page world as part of the trusted page boundary.

## Telemetry And Diagnostics

There is no default telemetry. Diagnostics exclude project content by default and are local exports intended for issue reports and release-candidate smoke testing. They are designed to exclude project text, prompt bodies, compile log content, raw diffs, binary data, and raw secrets by default. Diagnostics focus on extension/native versions, compatibility status, local environment health, file and byte counts, governance summaries, redacted audit summaries, and recoverable setup errors.

Native debug logs and launcher logs stay on the user's machine. Users should review and redact any manually copied logs, screenshots, filenames, project ids, prompts, and document text before sharing an issue report.

## Local Deletion Boundary

Removing the extension from the Chrome profile deletes that profile's extension IndexedDB and `chrome.storage.local` data. The native uninstaller removes Native Messaging registration, the bridge executable, and the runtime copy, but it intentionally leaves project mirrors, plugin Codex history, skills, and browser profile data for explicit user deletion.

Full local cleanup requires deleting both native/runtime directories and mirror/plugin directories:

- macOS/Linux: `~/.codex-overleaf` and the optional `~/Codex Overleaf Link Extension` shortcut.
- Windows: `%LOCALAPPDATA%\CodexOverleaf` and `%USERPROFILE%\.codex-overleaf`.
