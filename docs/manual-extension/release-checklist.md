# Manual Extension Release Checklist

Current release path: publish the GitHub Release artifacts, load the extension manually as an unpacked Chrome extension, and install the native host with the actual extension id shown by Chrome.

## Automated Verification

- Run `npm test`.
- Run `npm run verify:release`.
- Run `npm run verify:npm-package`.
- Run `npm run build:release`.
- Confirm `dist/releases/v1.1.0/SHA256SUMS` verifies every uploaded artifact.

## Release Artifact Hygiene

- Upload `codex-overleaf-link-extension-v1.1.0.zip` to the GitHub Release.
- Upload `codex-overleaf-native-host-v1.1.0.tar.gz` to the GitHub Release.
- Upload `codex-overleaf-link-1.1.0.tgz` to the GitHub Release.
- Upload `install.sh`, `install.ps1`, `uninstall-native-host.mjs`, `release-manifest.json`, `release-notes.md`, and `SHA256SUMS` to the GitHub Release.
- Confirm the extension zip contains only the loadable MV3 extension package and no specs, private assets, logs, credentials, local databases, or build-only files.
- Confirm the npm package upload includes `codex-overleaf-link-1.1.0.tgz` with the release artifacts before any later npm publish.

## Real Overleaf Smoke

- Download `codex-overleaf-link-extension-v1.1.0.zip` from the draft GitHub Release and unzip it to a stable local folder.
- Open `chrome://extensions`, enable Developer mode, click **Load unpacked**, and select the folder containing `manifest.json`.
- Copy the actual extension id shown by Chrome.
- Install the native host with `npm exec --yes codex-overleaf-link@1.1.0 -- install-native --extension-id <chrome-extension-id>`.
- Run `npm exec --yes codex-overleaf-link@1.1.0 -- doctor` and confirm the status is compatible.
- Open a real Overleaf project and smoke Ask, Suggest, Auto writeback, stale-write guard, undo checkpoint, compile capture, attachments, governance block, sensitive preflight, model picker, and diagnostics export.
- On Windows, repeat the install path with `install.ps1` and confirm the native doctor command still reports the registered host.

## Large-Project Performance Baseline

- Record cold startup, warm startup, snapshot sync, diff render, and writeback observations from the smoke project.
- Treat timing misses as release review inputs unless an explicit P0/P1 regression is found.

## Security And Privacy Review

- Confirm no default telemetry or hosted backend is introduced.
- Confirm diagnostics redact project text, prompts, compile logs, raw diffs, binary content, and raw secrets by default.
- Confirm native host `allowed_origins` contains only the actual manually loaded extension id used for this install.
- Confirm page-bridge threat model assumptions remain unchanged: extension/content issued capabilities gate browser mutation; this is not a defense against malicious Overleaf first-party code.

## Documentation Pass

- Confirm README v1.1.0 install guidance uses GitHub Release plus manual `Load unpacked` plus explicit `--extension-id <chrome-extension-id>`.
- Confirm README does not require browser store availability for the current release.
- Confirm update, recovery, Linux Chromium, Windows, uninstall, local data, and compatibility matrix commands reference v1.1.0.

## Compatibility Matrix

- Record macOS Chrome, Windows Chrome, Linux Chrome, and Linux Chromium results in the README compatibility matrix format.
- For Linux Chromium, install native host with `--browser chromium` and the same explicit `--extension-id <chrome-extension-id>`.

## P0/P1 Signoff

- Run `gh issue list --search 'is:issue is:open (label:P0 OR label:P1)'`.
- Do not publish the release if any untriaged P0 or release-blocking P1 remains open.
