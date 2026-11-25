#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 [--check]" >&2
}

mode=update
if [ "$#" -gt 1 ]; then
  usage
  exit 2
fi
if [ "$#" -eq 1 ]; then
  case "$1" in
    --check)
      mode=check
      ;;
    *)
      usage
      exit 2
      ;;
  esac
fi

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
front_root="$repo_root/front"
ui_root="$front_root/ui-react"
asset_dirs=(
  "$repo_root/knife4x/go/internal/ui/static"
  "$repo_root/knife4x/rust/static"
)
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/knife4x-ui.XXXXXX")"
build_dir="$tmp_dir/static"
trap 'rm -rf "$tmp_dir"' EXIT

bun "$front_root/scripts/check-bun.cjs"

cd "$front_root"
bun install --frozen-lockfile
bun run --filter knife4j-core build
bun run --filter knife4j-schema-engine build

cd "$ui_root"
bun "$front_root/scripts/tsc.cjs"
bun "$front_root/node_modules/vite/bin/vite.js" build --outDir="$build_dir" --emptyOutDir

index_html="$build_dir/index.html"
if [ ! -f "$index_html" ]; then
  echo "Missing Knife4x UI entry: $index_html" >&2
  exit 1
fi
if ! grep -q 'src="\./assets/' "$index_html" || ! grep -q 'href="\./assets/' "$index_html"; then
  echo "Knife4x UI entry must reference JavaScript and CSS under ./assets/" >&2
  exit 1
fi
if find "$build_dir" -type f -name '*.map' -print -quit | grep -q .; then
  echo "Knife4x UI assets must not contain source maps" >&2
  exit 1
fi

for asset_dir in "${asset_dirs[@]}"; do
  if [ -d "$asset_dir" ] && diff -qr "$asset_dir" "$build_dir" >/dev/null; then
    continue
  fi
  if [ "$mode" = check ]; then
    echo "Missing or stale Knife4x UI assets in $asset_dir; run ./tools/sync-knife4x-ui.sh" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$asset_dir")"
  rm -rf "$asset_dir"
  cp -R "$build_dir" "$asset_dir"
  echo "Updated Knife4x UI assets in $asset_dir"
done
echo "Go and Rust Knife4x UI assets are up to date"
