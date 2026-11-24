#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root/front"

bun scripts/check-bun.cjs
bun test ./scripts/check-bun.test.cjs
bun test ./ui-react/scripts/chrome-startup.test.mjs

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

# --- knife4x Go embedded UI assets ---
"$repo_root/tools/sync-knife4x-ui.sh" --check
