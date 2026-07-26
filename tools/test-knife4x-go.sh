#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
module_roots=(
  "$repo_root/knife4x/go"
  "$repo_root/knife4x/examples/gin"
)

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
assert_java_tag_filter "$repo_root/.github/workflows/deploy-demo.yml"

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
    go vet ./...
    go test ./...
  )
done
