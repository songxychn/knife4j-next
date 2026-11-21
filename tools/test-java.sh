#!/usr/bin/env bash
set -euo pipefail

# Auto-detect JAVA_HOME if not set (needed for maven-javadoc-plugin)
if [ -z "${JAVA_HOME:-}" ]; then
  JAVA_HOME=$(dirname "$(dirname "$(readlink -f "$(which java)")")") && export JAVA_HOME
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT/knife4j"

mvn -B -ntp spotless:check
mvn -B -ntp -Dknife4j-skipTests=false verify

python3 "$REPO_ROOT/knife4j/knife4j-openapi3-ui/src/test/scripts/test-incremental-webjar.py"
python3 "$REPO_ROOT/knife4j/knife4j-openapi3-ui/src/test/scripts/test-current-workspace.py"
python3 "$REPO_ROOT/knife4j/knife4j-openapi2-ui/src/test/scripts/test-incremental-webjar.py"

echo ""
echo "==> Verifying smoke-tests evidence"
"$REPO_ROOT/tools/smoke-evidence.sh"
