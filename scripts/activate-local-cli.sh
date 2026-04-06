#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_PATH="$REPO_DIR/cli.js"
CLAUDEX_PATH="$REPO_DIR/cli-ant.js"

if [[ ! -x "$CLI_PATH" ]]; then
  echo "Expected executable launcher at $CLI_PATH" >&2
  exit 1
fi

if [[ ! -f "$CLAUDEX_PATH" ]]; then
  echo "Expected ClaudeX ant launcher at $CLAUDEX_PATH" >&2
  exit 1
fi

chmod +x "$CLAUDEX_PATH"

TARGET_DIR="/opt/homebrew/bin"
ACTIVE_LINK="$TARGET_DIR/claudex-local"
FORK_LINK="$TARGET_DIR/claude-codex"
CLAUDEX_LINK="$TARGET_DIR/claudex"
BACKUP_LINK="$TARGET_DIR/claude-official"

mkdir -p "$TARGET_DIR"

if [[ -L "$ACTIVE_LINK" ]]; then
  current_target="$(readlink "$ACTIVE_LINK")"
  if [[ "$current_target" != "$CLI_PATH" ]]; then
    ln -snf "$current_target" "$BACKUP_LINK"
  fi
fi

ln -snf "$CLI_PATH" "$ACTIVE_LINK"
ln -snf "$CLI_PATH" "$FORK_LINK"
ln -snf "$CLAUDEX_PATH" "$CLAUDEX_LINK"

echo "Active claude launcher -> $CLI_PATH"
echo "Claude-codex launcher -> $CLI_PATH"
echo "Claudex launcher -> $CLAUDEX_PATH"
if [[ -L "$BACKUP_LINK" ]]; then
  echo "Official backup launcher -> $(readlink "$BACKUP_LINK")"
fi
