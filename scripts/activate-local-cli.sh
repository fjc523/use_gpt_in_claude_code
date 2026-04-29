#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLAUDEX_PATH="$REPO_DIR/cli-ant.js"

if [[ ! -f "$CLAUDEX_PATH" ]]; then
  echo "Expected ClaudeX launcher at $CLAUDEX_PATH" >&2
  exit 1
fi

chmod +x "$CLAUDEX_PATH"

TARGET_DIR="/opt/homebrew/bin"
ACTIVE_LINK="$TARGET_DIR/claudex-local"
FORK_LINK="$TARGET_DIR/claude-codex"
CLAUDEX_LINK="$TARGET_DIR/claudex"

mkdir -p "$TARGET_DIR"

ln -snf "$CLAUDEX_PATH" "$ACTIVE_LINK"
ln -snf "$CLAUDEX_PATH" "$FORK_LINK"
ln -snf "$CLAUDEX_PATH" "$CLAUDEX_LINK"

echo "ClaudeX local launcher -> $CLAUDEX_PATH"
echo "Claude-codex compatibility launcher -> $CLAUDEX_PATH"
echo "Claudex launcher -> $CLAUDEX_PATH"
echo "Official claude launcher is not modified."
