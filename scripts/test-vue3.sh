#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../knife4j-vue3"

bun install --frozen-lockfile
bun run build:Knife4jSpringUi

required_files=(
  "dist/doc.html"
  "dist/webjars/oauth/oauth2.html"
)

for file in "${required_files[@]}"; do
  if [ ! -f "$file" ]; then
    echo "Missing expected Vue3 build artifact: $file" >&2
    exit 1
  fi
done

if [ ! -d "dist/webjars" ]; then
  echo "Missing expected Vue3 build artifact: dist/webjars" >&2
  exit 1
fi
