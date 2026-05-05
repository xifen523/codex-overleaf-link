# Chrome Web Store Release Checklist

## Local Verification

- Run `npm test`.
- Run `npm run verify:release`.
- Run `npm run build:release`.
- Verify checksums from `dist/releases/v0.4.0/SHA256SUMS`.
- Inspect extension zip `codex-overleaf-link-extension-v0.4.0.zip` before upload.

## Store Preparation

- Confirm listing copy, privacy notes, and permission notes match the packaged manifest.
- Capture screenshots, small promo image, and optional marquee image.
- Record final Web Store extension id before native-host installer publication.
- Reinstall the native host with that id so `allowed_origins` matches the store extension.

## Scope

Actual Chrome Web Store submission is outside v0.4.
