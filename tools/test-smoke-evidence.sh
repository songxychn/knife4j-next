#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
script="$REPO_ROOT/tools/smoke-evidence.sh"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

module() {
  mkdir -p "$work/$1/target/surefire-reports"
  touch "$work/$1/pom.xml"
  if [ -n "${2:-}" ]; then
    echo "<testsuite tests=\"$2\" failures=\"$3\" errors=\"$4\"></testsuite>" >"$work/$1/target/surefire-reports/TEST-x.xml"
  fi
}

expect() {
  local want="$1" text="$2"
  shift 2
  set +e
  output="$(SMOKE_ROOT="$work" "$script" "$@" 2>&1)"
  status=$?
  set -e
  if [ "$status" != "$want" ] || ! grep -qF -- "$text" <<<"$output"; then
    echo "expected exit $want with '$text', got $status:" >&2
    echo "$output" >&2
    exit 1
  fi
}

expect 1 "No smoke modules found"
module ok-app 3 0 0
mkdir -p "$work/not-a-module"
expect 0 "Smoke-tests evidence OK (1 modules)"
module missing-app
expect 1 "gate failed for: missing-app"
expect 0 "| missing-app | (missing) | - | - |" --summary
rm -rf "$work/missing-app"
module empty-app 0 0 0
expect 1 "gate failed for: empty-app"
rm -rf "$work/empty-app"
module failed-app 2 1 0
expect 1 "gate failed for: failed-app"
expect 0 "| failed-app | 2 | 1 | 0 |" --summary
echo "smoke-evidence tests OK"
