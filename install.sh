#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${CODEX_OVERLEAF_REPO_URL:-https://github.com/Ghqqqq/codex-overleaf-link.git}"
REF="${CODEX_OVERLEAF_REF:-main}"
INSTALL_DIR="${CODEX_OVERLEAF_INSTALL_DIR:-$HOME/.codex-overleaf/source}"

need_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need_command git
need_command node

echo "CODEX_OVERLEAF_REF: $REF"

mkdir -p "$(dirname "$INSTALL_DIR")"

if [ -d "$INSTALL_DIR/.git" ]; then
  echo "Updating Codex Overleaf Link in $INSTALL_DIR"
  git -C "$INSTALL_DIR" fetch --depth 1 origin "$REF"
  git -C "$INSTALL_DIR" checkout --detach FETCH_HEAD >/dev/null
else
  echo "Installing Codex Overleaf Link into $INSTALL_DIR"
  rm -rf "$INSTALL_DIR"
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
  git -C "$INSTALL_DIR" fetch --depth 1 origin "$REF"
  git -C "$INSTALL_DIR" checkout --detach FETCH_HEAD >/dev/null
fi

PACKAGE_VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$INSTALL_DIR/package.json" | head -n 1)"
if [ -z "$PACKAGE_VERSION" ]; then
  PACKAGE_VERSION="unknown"
fi

if [ -n "${CODEX_OVERLEAF_EXTENSION_ID:-}" ]; then
  node "$INSTALL_DIR/scripts/install-native-host.mjs" --extension-id "$CODEX_OVERLEAF_EXTENSION_ID" "$@"
else
  node "$INSTALL_DIR/scripts/install-native-host.mjs" "$@"
fi

EXTENSION_DIR="$INSTALL_DIR/extension"
VISIBLE_EXTENSION_DIR="${CODEX_OVERLEAF_EXTENSION_LINK:-$HOME/Codex Overleaf Link Extension}"
LOAD_UNPACKED_PATH="$EXTENSION_DIR"

if [ -L "$VISIBLE_EXTENSION_DIR" ]; then
  rm "$VISIBLE_EXTENSION_DIR"
fi

if [ ! -e "$VISIBLE_EXTENSION_DIR" ]; then
  ln -s "$EXTENSION_DIR" "$VISIBLE_EXTENSION_DIR"
  LOAD_UNPACKED_PATH="$VISIBLE_EXTENSION_DIR"
else
  echo "Could not create visible extension shortcut because this path already exists:" >&2
  echo "  $VISIBLE_EXTENSION_DIR" >&2
  echo "Use the real extension directory instead:" >&2
  echo "  $EXTENSION_DIR" >&2
fi

COPIED_EXTENSION_PATH=0
if command -v pbcopy >/dev/null 2>&1; then
  printf "%s" "$LOAD_UNPACKED_PATH" | pbcopy >/dev/null 2>&1 && COPIED_EXTENSION_PATH=1
fi

echo
echo "Codex Overleaf Link native host is installed."
echo "Package version: $PACKAGE_VERSION"
echo "Extension path: $EXTENSION_DIR"
echo
echo "Chrome extension setup:"
echo "  Chrome does not allow scripts to load unpacked extensions automatically."
echo "  In the Chrome extensions page, enable Developer mode, click Load unpacked, then choose:"
echo "  $LOAD_UNPACKED_PATH"
if [ "$COPIED_EXTENSION_PATH" = "1" ]; then
  echo "  This folder path has also been copied to your clipboard."
fi
echo
echo "Next steps:"
echo "  1. Reload the Chrome extension in chrome://extensions."
echo "  2. Refresh the Overleaf page."

if command -v open >/dev/null 2>&1; then
  open -a "Google Chrome" "chrome://extensions" >/dev/null 2>&1 || open "chrome://extensions" >/dev/null 2>&1 || true
  open -R "$LOAD_UNPACKED_PATH" >/dev/null 2>&1 || true
fi
