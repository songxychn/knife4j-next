#!/usr/bin/env bash
set -euo pipefail

# Keep the caller's tools, but expose no standalone Node.js/npm executable.
# Bun may create its own `node` alias for Node-compatible package CLIs.
if [ "$#" -eq 0 ]; then
  echo "Usage: $0 command [args...]" >&2
  exit 2
fi
original_path="$PATH"
tool_dir="$(mktemp -d "${TMPDIR:-/tmp}/knife4j-without-node.XXXXXX")"
trap 'rm -rf "$tool_dir"' EXIT
python3 - "$tool_dir" <<'PY'
import os
import pathlib
import sys

target = pathlib.Path(sys.argv[1])
excluded = {'node', 'nodejs', 'npm', 'npx', 'corepack'}
for entry in os.environ['PATH'].split(os.pathsep):
    directory = pathlib.Path(entry or '.')
    if not directory.is_dir():
        continue
    for source in directory.iterdir():
        destination = target / source.name
        if (source.name not in excluded and not destination.exists()
                and not destination.is_symlink() and source.is_file()
                and os.access(source, os.X_OK)):
            destination.symlink_to(source.absolute())
PY
export PATH="$tool_dir"
if command -v node >/dev/null 2>&1 || command -v nodejs >/dev/null 2>&1; then
  echo "Standalone Node.js must not be available" >&2
  exit 1
fi
echo "Running without standalone Node.js: $*" >&2
# Restore PATH before the EXIT trap so cleanup remains possible after the command.
result=0
"$@" || result=$?
export PATH="$original_path"
exit "$result"
