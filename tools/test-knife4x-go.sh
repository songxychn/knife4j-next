#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
module=all
if [ "$#" -ne 0 ]; then
  if [ "$#" -ne 2 ] || [ "$1" != "--module" ]; then
    echo "Usage: $0 [--module core|gin|all]" >&2
    exit 1
  fi
  module=$2
fi
case "$module" in
  core) module_roots=("$repo_root/knife4x/go") ;;
  gin) module_roots=("$repo_root/knife4x/examples/gin") ;;
  all) module_roots=("$repo_root/knife4x/go" "$repo_root/knife4x/examples/gin") ;;
  *)
    echo "Unknown module: $module (expected core, gin or all)" >&2
    exit 1
    ;;
esac

# Test the selected toolchain, rather than silently downloading a newer one.
export GOTOOLCHAIN=local
go version

assert_java_tag_filter() {
  local workflow=$1
  local actual

  actual="$(
    awk '
      /^[[:space:]]+tags:[[:space:]]*$/ { in_tags=1; next }
      in_tags && /^[[:space:]]+-[[:space:]]+/ {
        value=$0
        sub(/^[[:space:]]+-[[:space:]]+/, "", value)
        gsub(/^[\047\042]|[\047\042]$/, "", value)
        print value
        next
      }
      in_tags { exit }
    ' "$workflow"
  )"
  if [ "$actual" != "v*" ]; then
    printf 'Java workflow tag filter changed in %s: %s\n' "$workflow" "$actual" >&2
    exit 1
  fi
}

assert_java_tag_filter "$repo_root/.github/workflows/release.yml"

demo_workflow="$repo_root/.github/workflows/deploy-demo.yml"
if grep -Eq '^  push:' "$demo_workflow"; then
  echo "Demo workflow must be called by the verified Java release instead of matching tags directly" >&2
  exit 1
fi
for expected in '  workflow_call:' '  workflow_dispatch:' '  RELEASE_TAG: ${{ inputs.tag }}'; do
  if ! grep -Fq -- "$expected" "$demo_workflow"; then
    printf 'Demo workflow is missing explicit release-tag contract: %s\n' "$expected" >&2
    exit 1
  fi
done

case "knife4x/go/v0.1.0" in
  v*)
    echo "Knife4x Go tag must not match the Java v* release route" >&2
    exit 1
    ;;
esac

unformatted="$(gofmt -l "${module_roots[@]}")"
if [ -n "$unformatted" ]; then
  printf 'Go files need formatting:\n%s\n' "$unformatted" >&2
  exit 1
fi

for module_root in "${module_roots[@]}"; do
  (
    cd "$module_root"
    go vet -mod=readonly ./...
    go test -mod=readonly ./...
  )
done

# Public Go changes also validate their authoritative documentation and examples.
if [ "$module" != gin ]; then
  go run "$repo_root/tools/check-knife4x-docs.go" --root "$repo_root"
fi
