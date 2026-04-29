#!/usr/bin/env bash
set -euo pipefail

TARGET_DIR="/opt/homebrew/bin"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLAUDEX_PATH="$REPO_DIR/cli-ant.js"

for name in claudex claudex-local claude-codex; do
  link="$TARGET_DIR/$name"
  if [[ -L "$link" && "$(readlink "$link")" == "$CLAUDEX_PATH" ]]; then
    rm "$link"
    echo "Removed $link"
  fi
done

echo "Official claude launcher was not modified by this repo."
