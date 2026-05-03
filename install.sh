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

installer_args=()
if [ -n "${CODEX_OVERLEAF_EXTENSION_ID:-}" ]; then
  installer_args+=(--extension-id "$CODEX_OVERLEAF_EXTENSION_ID")
fi

node "$INSTALL_DIR/scripts/install-native-host.mjs" "${installer_args[@]}" "$@"

echo
echo "Codex Overleaf Link native host is installed."
echo "Next steps:"
echo "  1. Open chrome://extensions"
echo "  2. Enable Developer mode"
echo "  3. Click Load unpacked"
echo "  4. Select: $INSTALL_DIR/extension"
echo "  5. Reload the extension after future updates"

if command -v open >/dev/null 2>&1; then
  open "chrome://extensions" >/dev/null 2>&1 || true
fi
