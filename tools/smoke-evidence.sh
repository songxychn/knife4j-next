#!/usr/bin/env bash
# Check surefire evidence for every module under knife4j-smoke-tests/.
# Modules are discovered from <module>/pom.xml, so this is the only list.
#   smoke-evidence.sh            gate: fail unless every module ran >0 tests cleanly
#   smoke-evidence.sh --summary  print a Markdown table and always exit 0
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SMOKE_ROOT="${SMOKE_ROOT:-$REPO_ROOT/knife4j/knife4j-smoke-tests}"
mode="${1:-gate}"

modules=()
for pom in "$SMOKE_ROOT"/*/pom.xml; do
  [ -f "$pom" ] && modules+=("$(basename "$(dirname "$pom")")")
done
if [ "${#modules[@]}" -eq 0 ]; then
  if [ "$mode" = "--summary" ]; then
    echo "### Smoke-tests evidence"
    echo ""
    echo "No smoke modules found under \`$SMOKE_ROOT\`."
    exit 0
  fi
  echo "No smoke modules found under $SMOKE_ROOT" >&2
  exit 1
fi

attr() {
  grep -oE "$1=\"[0-9]+\"" "$2" | head -n1 | grep -oE '[0-9]+' || echo 0
}

if [ "$mode" = "--summary" ]; then
  echo "### Smoke-tests evidence"
  echo ""
  echo "| module | tests | failures | errors |"
  echo "| --- | ---: | ---: | ---: |"
fi

bad=()
for module in "${modules[@]}"; do
  shopt -s nullglob
  xml_files=("$SMOKE_ROOT/$module/target/surefire-reports"/TEST-*.xml)
  shopt -u nullglob

  tests=0 failures=0 errors=0
  for xml in ${xml_files[@]+"${xml_files[@]}"}; do
    tests=$((tests + $(attr tests "$xml")))
    failures=$((failures + $(attr failures "$xml")))
    errors=$((errors + $(attr errors "$xml")))
  done

  if [ "${#xml_files[@]}" -eq 0 ]; then
    status="MISSING"
  elif [ "$tests" -eq 0 ]; then
    status="EMPTY"
  elif [ "$failures" -ne 0 ] || [ "$errors" -ne 0 ]; then
    status="FAIL"
  else
    status="OK"
  fi
  [ "$status" = "OK" ] || bad+=("$module")

  if [ "$mode" = "--summary" ]; then
    if [ "$status" = "MISSING" ]; then
      echo "| $module | (missing) | - | - |"
    else
      echo "| $module | $tests | $failures | $errors |"
    fi
  else
    printf '   [%-7s] %s: tests=%s failures=%s errors=%s\n' "$status" "$module" "$tests" "$failures" "$errors"
  fi
done

[ "$mode" = "--summary" ] && exit 0

if [ "${#bad[@]}" -ne 0 ]; then
  echo "" >&2
  echo "Smoke evidence gate failed for: ${bad[*]}" >&2
  echo "The main 'mvn verify' must exercise every module under knife4j-smoke-tests/." >&2
  exit 1
fi
echo "==> Smoke-tests evidence OK (${#modules[@]} modules)"
