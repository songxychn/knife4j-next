#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../docs"

bun ../front/scripts/check-bun.cjs

export GOTOOLCHAIN=local
go test ../tools/check-knife4x-docs.go ../tools/check-knife4x-docs_test.go
go run ../tools/check-knife4x-docs.go --root ..

bun install --frozen-lockfile
bun run build

go run ../tools/check-knife4x-docs.go --root .. --site .vitepress/dist
