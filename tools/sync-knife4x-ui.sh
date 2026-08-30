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
asset_dir="$repo_root/knife4x/go/internal/ui/static"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/knife4x-ui.XXXXXX")"
build_dir="$tmp_dir/static"
trap 'rm -rf "$tmp_dir"' EXIT

node_bin="$(command -v node || true)"
if [ -z "$node_bin" ]; then
  echo "Node.js is required to build reproducible Knife4x UI assets; use the version from .nvmrc" >&2
  exit 1
fi

cd "$front_root"
bun install --frozen-lockfile
bun run --filter knife4j-core build
bun run --filter knife4j-schema-engine build

cd "$ui_root"
"$node_bin" "$ui_root/node_modules/typescript/bin/tsc"
"$node_bin" "$front_root/node_modules/vite/bin/vite.js" build --outDir="$build_dir" --emptyOutDir

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

if [ "$mode" = check ]; then
  if [ ! -d "$asset_dir" ]; then
    echo "Missing committed Knife4x UI assets: $asset_dir" >&2
    exit 1
  fi
  if ! diff -qr "$asset_dir" "$build_dir"; then
    echo "Knife4x UI assets are stale; run ./tools/sync-knife4x-ui.sh" >&2
    exit 1
  fi
  echo "Knife4x UI assets are up to date"
  exit 0
fi

mkdir -p "$(dirname "$asset_dir")"
rm -rf "$asset_dir"
mv "$build_dir" "$asset_dir"
echo "Updated Knife4x UI assets in $asset_dir"
