#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
module_roots=(
  "$repo_root/knife4x/go"
  "$repo_root/knife4x/examples/gin"
)

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
