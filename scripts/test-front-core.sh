#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../knife4j-front"

npm ci

# --- knife4j-core ---
npm run format:check -w knife4j-core
npm test -w knife4j-core
npm run lint -w knife4j-core
npm run build -w knife4j-core

# --- knife4j-ui-react ---
npm run format:check -w knife4j-ui-react
npm run build -w knife4j-ui-react
npm run lint -w knife4j-ui-react
