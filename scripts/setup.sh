#!/usr/bin/env bash
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Error: This script only supports macOS."
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "Checking for k6..."
if ! command -v k6 &>/dev/null; then
  echo "k6 not found. Installing via Homebrew..."
  if command -v brew &>/dev/null; then
    brew install k6
    echo "k6 installed successfully:"
    k6 version
  else
    echo "Error: Homebrew is not installed. Please install k6 manually:"
    echo "  brew install k6"
    echo "  or visit https://k6.io/docs/get-started/installation/"
    exit 1
  fi
else
  echo "k6 is already installed:"
  k6 version
fi

echo ""
echo "Checking for Playwright Chromium..."
if node -e "const { chromium } = require('$ROOT_DIR/node_modules/playwright'); const fs = require('fs'); process.exit(fs.existsSync(chromium.executablePath()) ? 0 : 1)" 2>/dev/null; then
  echo "Playwright Chromium is already installed."
else
  echo "Installing Playwright Chromium..."
  npx --prefix "$ROOT_DIR" playwright install chromium
fi
