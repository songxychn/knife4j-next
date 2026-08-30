#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SPIKE_DIR="${ROOT_DIR}/tools/spikes/json-schema-2020-12"

cd "${SPIKE_DIR}"
bun install --frozen-lockfile --registry https://registry.npmjs.org
bun run check
