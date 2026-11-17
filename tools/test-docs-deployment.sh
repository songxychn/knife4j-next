#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
# Run after test-java.sh: use this checkout's WebJar and built frontend dependencies.
bun "$repo_root/tools/docs/deployment-contract.mjs"
python3 "$repo_root/tools/docs/test-deployment.py"
