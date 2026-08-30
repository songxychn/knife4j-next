#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SPIKE_DIR="${ROOT_DIR}/tools/spikes/oas31-resource-loader"

cd "${SPIKE_DIR}"
bun install --frozen-lockfile
bun run check
