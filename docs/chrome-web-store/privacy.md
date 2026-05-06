# Chrome Web Store Privacy Notes

## Data Flow

Codex Overleaf Link adds no hosted backend. The extension talks to a local Native Messaging host, and the native host talks to the user's configured local Codex CLI account.

Project mirrors are stored under `~/.codex-overleaf/projects`. Project-local skills are stored under the Codex Overleaf local data area for the specific project. Plugin-isolated Codex state is stored under `~/.codex-overleaf/codex-home` so plugin sessions do not mix with the user's global Codex session history.

## Processing

Codex processing uses the user's configured local Codex CLI account. The project does not add a service account, hosted relay, or remote audit store.

## Telemetry And Diagnostics

There is no default telemetry. Diagnostics exclude project content by default and focus on connection status, version compatibility, local environment health, governance decisions, and recoverable setup errors. Local audit records are stored locally and avoid prompt bodies or document text by default. Issue reports should redact any manually copied logs before sharing.
