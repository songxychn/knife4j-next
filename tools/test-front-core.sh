#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../front"

node_bin="$(command -v node || true)"
if [ -z "$node_bin" ]; then
  echo "Node.js is required for front-end tooling; use .nvmrc" >&2
  exit 1
fi
"$node_bin" scripts/check-node.cjs
"$node_bin" --test scripts/check-node.test.cjs

bun install --frozen-lockfile

# --- knife4j-schema-engine ---
bun run --filter knife4j-schema-engine format:check
bun run --filter knife4j-schema-engine test
bun run --filter knife4j-schema-engine lint
bun run --filter knife4j-schema-engine build
bun run --filter knife4j-schema-engine check:browser

# --- knife4j-core ---
bun run --filter knife4j-core format:check
bun run --filter knife4j-core test
bun run --filter knife4j-core lint
bun run --filter knife4j-core build

# --- knife4j-ui-react ---
bun run --filter knife4j-ui-react format:check
bun run --filter knife4j-ui-react test
bun run --filter knife4j-ui-react build
bun run --filter knife4j-ui-react lint
