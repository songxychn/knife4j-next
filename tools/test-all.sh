#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"

"$repo_root/tools/test-java.sh"
"$repo_root/tools/test-front-core.sh"
"$repo_root/tools/test-docs.sh"
