#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../docs"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required for front-end tooling; use .nvmrc" >&2
  exit 1
fi
node ../front/scripts/check-node.cjs

bun install --frozen-lockfile
bun run build
