#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
crate="$repo_root/knife4x/rust"
example="$repo_root/knife4x/examples/axum"
work="$(mktemp -d "${TMPDIR:-/tmp}/knife4x-rust.XXXXXX")"
trap 'rm -rf "$work"' EXIT

if [ "$#" -ne 0 ] && { [ "$#" -ne 2 ] || [ "$1" != "--registry" ]; }; then
  echo "Usage: $0 [--registry VERSION]" >&2
  exit 2
fi

consumer="$work/examples/axum"
mkdir -p "$consumer"
cp -R "$example/Cargo.toml" "$example/Cargo.lock" "$example/src" "$consumer/"
cd "$consumer"

if [ "$#" -eq 2 ]; then
  # A fresh registry cache makes this a verification of the publicly downloadable crate.
  export CARGO_HOME="$work/cargo-home"
  version=$2
  cargo add --registry crates-io "knife4x@=$version"
  cargo metadata --locked --format-version 1 > "$work/metadata.json"
  package_dir="$(python3 - "$work/metadata.json" "$version" "$(git -C "$repo_root" rev-parse HEAD)" <<'PY'
import json
from pathlib import Path
import sys

metadata_path, version, commit = sys.argv[1:]
packages = json.loads(Path(metadata_path).read_text())["packages"]
package = next(p for p in packages if p["name"] == "knife4x" and p["version"] == version)
if package["source"] != "registry+https://github.com/rust-lang/crates.io-index":
    sys.exit("Expected Knife4x from crates.io")
path = Path(package["manifest_path"]).parent
vcs = json.loads((path / ".cargo_vcs_info.json").read_text())
if vcs["git"]["sha1"] != commit or vcs["git"].get("dirty") or vcs["path_in_vcs"] != "knife4x/rust":
    sys.exit(f"Crate source does not match knife4x/rust at {commit}")
print(path)
PY
)"
else
  cd "$crate"
  cargo fmt --all --check
  cargo fmt --manifest-path "$example/Cargo.toml" --all --check
  cargo test --locked --no-default-features
  cargo test --locked --all-features
  cargo clippy --locked --all-targets --all-features -- -D warnings

  # Share dependency builds with the isolated consumer, honoring Cargo's configured target directory.
  cargo metadata --locked --no-deps --format-version 1 > "$work/metadata.json"
  target_dir="$(python3 -c 'import json, sys; print(json.load(sys.stdin)["target_directory"])' < "$work/metadata.json")"
  version="$(python3 -c 'import json, sys; print(next(p["version"] for p in json.load(sys.stdin)["packages"] if p["name"] == "knife4x"))' < "$work/metadata.json")"
  export CARGO_TARGET_DIR="$target_dir"

  # Developer tests may include pending changes. Publishing separately requires a clean checkout.
  cargo package --locked --allow-dirty
  package_dir="$work/rust"
  mkdir "$package_dir"
  tar -xzf "$target_dir/package/knife4x-$version.crate" --strip-components=1 -C "$package_dir"
fi

diff -qr "$repo_root/knife4x/go/internal/ui/static" "$package_dir/static"
test -s "$package_dir/LICENSE"
cd "$consumer"
cargo test --locked
