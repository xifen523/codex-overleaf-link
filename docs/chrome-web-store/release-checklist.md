# Chrome Web Store Release Checklist

## Local Verification

- Run `npm test`.
- Run `npm run verify:release`.
- Run `npm run build:release`.
- Verify checksums from `dist/releases/v0.6.0/SHA256SUMS`.
- Inspect extension zip `codex-overleaf-link-extension-v0.6.0.zip` before upload.
- Inspect native host tarball `codex-overleaf-native-host-v0.6.0.tar.gz` before upload.
- Confirm the release `install.sh` defaults `CODEX_OVERLEAF_REF` to `v0.6.0`.
- Confirm the release `install.ps1` defaults `$DefaultRef` to `v0.6.0`.

## Store Preparation

- Confirm listing copy, privacy notes, and permission notes match the packaged manifest.
- Capture screenshots, small promo image, and optional marquee image.
- Record final Web Store extension id before native-host installer publication.
- Reinstall the native host with that id so `allowed_origins` matches the store extension.

## Scope

Actual Chrome Web Store submission remains a manual store-console step after the v0.6.0 release artifacts pass verification.
