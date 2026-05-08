# Manual Extension Release Checklist

Current release path: publish the GitHub Release artifacts, install the native host with the release-pinned npm command, and load the extension manually as an unpacked Chrome extension. The official extension build uses the bundled stable id by default; `install.sh` and `install.ps1` remain fallback installers.

## Automated Verification

- Run `npm test`.
- Run `npm run verify:release`.
- Run `npm run verify:npm-package`.
- Run `npm run build:release`.
- Confirm `dist/releases/v1.1.1/SHA256SUMS` verifies every uploaded artifact.

## Release Artifact Hygiene

- Upload `codex-overleaf-link-extension-v1.1.1.zip` to the GitHub Release.
- Upload `codex-overleaf-native-host-v1.1.1.tar.gz` to the GitHub Release.
- Upload `codex-overleaf-link-1.1.1.tgz` to the GitHub Release.
- Upload `install.sh`, `install.ps1`, `uninstall-native-host.mjs`, `release-manifest.json`, `release-notes.md`, and `SHA256SUMS` to the GitHub Release.
- Confirm the extension zip contains only the loadable MV3 extension package and no specs, private assets, logs, credentials, local databases, or build-only files.
- Confirm the npm package upload includes `codex-overleaf-link-1.1.1.tgz` with the release artifacts before any later npm publish.

## Real Overleaf Smoke

- Download `codex-overleaf-link-extension-v1.1.1.zip` from the draft GitHub Release and unzip it to a stable local folder.
- Open `chrome://extensions`, enable Developer mode, click **Load unpacked**, and select the folder containing `manifest.json`.
- Install or update the native host with `npm exec --yes codex-overleaf-link@1.1.1 -- install-native`.
- If npm is unavailable, validate the fallback path with `CODEX_OVERLEAF_REF=v1.1.1 bash -c "$(curl -fsSL https://raw.githubusercontent.com/Ghqqqq/codex-overleaf-link/v1.1.1/install.sh)"` on macOS/Linux, or with the documented `install.ps1` command on Windows.
- Optionally run `npm exec --yes codex-overleaf-link@1.1.1 -- doctor` and confirm the status is compatible.
- Open a real Overleaf project and smoke Ask, Suggest, Auto writeback, stale-write guard, undo checkpoint, compile capture, attachments, governance block, sensitive preflight, model picker, and diagnostics export.
- On Windows, repeat the npm install path and confirm the native doctor command still reports the registered host; validate `install.ps1` as the fallback installer.

## Large-Project Performance Baseline

- Record cold startup, warm startup, snapshot sync, diff render, and writeback observations from the smoke project.
- Treat timing misses as release review inputs unless an explicit P0/P1 regression is found.

## Security And Privacy Review

- Confirm no default telemetry or hosted backend is introduced.
- Confirm diagnostics redact project text, prompts, compile logs, raw diffs, binary content, and raw secrets by default.
- Confirm native host `allowed_origins` contains only the bundled stable extension id, or the explicit custom id supplied with `--extension-id`.
- Confirm page-bridge threat model assumptions remain unchanged: extension/content issued capabilities gate browser mutation; this is not a defense against malicious Overleaf first-party code.

## Documentation Pass

- Confirm README v1.1.1 install guidance uses the release-pinned npm native-host command plus manual `Load unpacked`, without requiring users to copy an extension id for official builds.
- Confirm README does not require browser store availability for the current release.
- Confirm update, recovery, Linux Chromium, Windows, uninstall, local data, and compatibility matrix commands reference v1.1.1.

## Compatibility Matrix

- Record macOS Chrome, Windows Chrome, Linux Chrome, and Linux Chromium results in the README compatibility matrix format.
- For Linux Chromium, install native host with `--browser chromium`; use `--extension-id <chrome-extension-id>` only for custom builds with a different id.

## P0/P1 Signoff

- Run `gh issue list --search 'is:issue is:open (label:P0 OR label:P1)'`.
- Do not publish the release if any untriaged P0 or release-blocking P1 remains open.
