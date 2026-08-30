#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../front"

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
