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

export GOTOOLCHAIN=local
go version

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
