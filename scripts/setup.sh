#!/usr/bin/env bash
set -euo pipefail

echo "Checking for k6..."

if command -v k6 &>/dev/null; then
  echo "k6 is already installed:"
  k6 version
  exit 0
fi

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
