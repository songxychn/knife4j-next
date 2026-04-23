#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"

"$repo_root/scripts/test-java.sh"
"$repo_root/scripts/test-front-core.sh"
"$repo_root/scripts/test-docs.sh"
