#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
module_root="$repo_root/knife4x/go"

unformatted="$(gofmt -l "$module_root")"
if [ -n "$unformatted" ]; then
  printf 'Go files need formatting:\n%s\n' "$unformatted" >&2
  exit 1
fi

cd "$module_root"
go vet ./...
go test ./...
