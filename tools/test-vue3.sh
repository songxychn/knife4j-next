#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../front/vue3"

if ! command -v node >/dev/null 2>&1; then
  echo "Vue3 requires Node.js 26.x; install Node.js before running this check." >&2
  exit 1
fi
node scripts/check-node.mjs

bun install --frozen-lockfile
bun run check:i18n
bun run check:search-menu
bun run check:store
bun run check:router
bun run check:codegen
bun run check:markdown
bun run check:webjar-resources
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

# Execute the production ES modules and verify Springfox + desktop startup.
node --experimental-vm-modules scripts/check-webjar-smoke.mjs dist
