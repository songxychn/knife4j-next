#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../docs"

bun ../front/scripts/check-bun.cjs
bun install --frozen-lockfile
bun run build
