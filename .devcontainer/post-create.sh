#!/usr/bin/env bash
set -euo pipefail

echo "[devcontainer] Preparing fio-webui development environment..."

export NPM_CONFIG_PREFIX="${NPM_CONFIG_PREFIX:-/home/vscode/.npm-global}"
export NPM_REGISTRY="${FIO_WEBUI_NPM_REGISTRY:-${NPM_CONFIG_REGISTRY:-https://registry.npmmirror.com}}"
export GOPROXY="${GOPROXY:-https://goproxy.cn,direct}"
export PATH="${NPM_CONFIG_PREFIX}/bin:${PATH}"

# Keep global npm installs writable for the non-root vscode user.
mkdir -p "${NPM_CONFIG_PREFIX}"

echo "[devcontainer] Using npm registry: ${NPM_REGISTRY}"
npm config set registry "${NPM_REGISTRY}" --location=user

echo "[devcontainer] Using Go proxy: ${GOPROXY}"
go env -w GOPROXY="${GOPROXY}"

echo "[devcontainer] Installing global AI CLIs with npm..."
npm install -g @openai/codex @anthropic-ai/claude-code

echo "[devcontainer] Installing air for Go hot reload..."
go install github.com/air-verse/air@latest

if [ -f go.mod ]; then
  echo "[devcontainer] Downloading Go modules..."
  go mod download
fi

if [ -f frontend/package.json ]; then
  echo "[devcontainer] Installing frontend dependencies..."
  cd frontend
  if [ -f package-lock.json ]; then
    npm ci
  else
    npm install
  fi
fi

echo "[devcontainer] Ready. Try: make dev"
