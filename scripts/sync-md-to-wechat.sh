#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO_ROOT/skills/tuzi-markdown-to-html/scripts/md/"
DEST="$REPO_ROOT/skills/tuzi-post-to-wechat/scripts/md/"

echo "Syncing: $SRC → $DEST"

rsync -av --delete \
  --exclude 'node_modules/' \
  --exclude 'package-lock.json' \
  "$SRC" "$DEST"

echo "Installing dependencies..."
cd "$DEST" && npm install

echo "Done."
