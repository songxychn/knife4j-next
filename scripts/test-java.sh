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

# ---------------------------------------------------------------------------
# Smoke-tests evidence gate (issue #241 / #198 FU-3)
#
# The reactor above already includes `knife4j-smoke-tests/*` because they are
# declared in `knife4j/pom.xml`'s <modules>. That coverage is implicit, though,
# so this guard turns it into an explicit, auditable signal:
#
#   - every known smoke module must have produced a surefire report
#   - every produced report must show > 0 tests executed and 0 failures/errors
#
# The check is cheap (it only reads XML files already written by surefire) and
# fails loudly if a future change silently drops a smoke module from the build.
# ---------------------------------------------------------------------------

SMOKE_MODULES=(
  "boot2-app"
  "boot2-openapi3-app"
  "boot3-app"
  "boot3-jakarta-app"
  "boot35-jakarta-app"
  "boot4-jakarta-app"
)

SMOKE_ROOT="$REPO_ROOT/knife4j/knife4j-smoke-tests"
missing=()

echo ""
echo "==> Verifying smoke-tests evidence (issue #241)"
for module in "${SMOKE_MODULES[@]}"; do
  reports_dir="$SMOKE_ROOT/$module/target/surefire-reports"
  if [ ! -d "$reports_dir" ]; then
    echo "   [MISSING] $module: no surefire-reports directory at $reports_dir"
    missing+=("$module")
    continue
  fi

  # Any TEST-*.xml counts; summarise tests / failures / errors.
  shopt -s nullglob
  xml_files=("$reports_dir"/TEST-*.xml)
  shopt -u nullglob
  if [ "${#xml_files[@]}" -eq 0 ]; then
    echo "   [MISSING] $module: surefire-reports contains no TEST-*.xml"
    missing+=("$module")
    continue
  fi

  tests=0
  failures=0
  errors=0
  for xml in "${xml_files[@]}"; do
    # Read the <testsuite ... tests=".." failures=".." errors=".."> attributes.
    t=$(grep -oE 'tests="[0-9]+"' "$xml" | head -n1 | grep -oE '[0-9]+' || echo 0)
    f=$(grep -oE 'failures="[0-9]+"' "$xml" | head -n1 | grep -oE '[0-9]+' || echo 0)
    e=$(grep -oE 'errors="[0-9]+"' "$xml" | head -n1 | grep -oE '[0-9]+' || echo 0)
    tests=$((tests + t))
    failures=$((failures + f))
    errors=$((errors + e))
  done

  if [ "$tests" -eq 0 ]; then
    echo "   [EMPTY]   $module: surefire ran but reported 0 tests"
    missing+=("$module")
    continue
  fi
  if [ "$failures" -ne 0 ] || [ "$errors" -ne 0 ]; then
    echo "   [FAIL]    $module: tests=$tests failures=$failures errors=$errors"
    missing+=("$module")
    continue
  fi

  echo "   [OK]      $module: tests=$tests failures=0 errors=0"
done

if [ "${#missing[@]}" -ne 0 ]; then
  echo ""
  echo "Smoke evidence gate failed for: ${missing[*]}" >&2
  echo "The main 'mvn verify' must exercise every module under knife4j-smoke-tests/." >&2
  echo "If a module was intentionally removed, update SMOKE_MODULES in scripts/test-java.sh." >&2
  exit 1
fi

echo "==> Smoke-tests evidence OK (${#SMOKE_MODULES[@]} modules)"
