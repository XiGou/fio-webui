#!/usr/bin/env bash
set -euo pipefail

CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"
SKILLS_DIR="$CODEX_HOME_DIR/skills"
TARGET_DIR="$SKILLS_DIR/impeccable"
REPO_URL="https://github.com/pbakaus/impeccable"

mkdir -p "$SKILLS_DIR"

if [ -d "$TARGET_DIR/.git" ]; then
  echo "Updating skill: $TARGET_DIR"
  git -C "$TARGET_DIR" pull --ff-only
else
  echo "Cloning skill from $REPO_URL"
  git clone "$REPO_URL" "$TARGET_DIR"
fi

echo "Skill ready at: $TARGET_DIR"
