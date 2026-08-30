#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "Usage: $0 <annotated-tag> [release-notes-output]" >&2
  exit 2
fi

tag="$1"
release_notes_output="${2:-}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="${VERIFY_RELEASE_REPO_ROOT:-$(cd "$script_dir/.." && pwd)}"
pom_file="${VERIFY_RELEASE_POM_FILE:-$repo_root/knife4j/pom.xml}"
notes_file="${VERIFY_RELEASE_NOTES_FILE:-$repo_root/docs/release-notes/index.md}"

fail() {
  echo "Release context verification failed: $*" >&2
  exit 1
}

if ! [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  fail "tag must match vX.Y.Z, got '$tag'."
fi

if ! git -C "$repo_root" show-ref --verify --quiet "refs/tags/$tag"; then
  fail "tag does not exist: $tag."
fi

tag_type="$(git -C "$repo_root" cat-file -t "refs/tags/$tag")"
if [ "$tag_type" != "tag" ]; then
  fail "tag must be annotated: $tag (object type: $tag_type)."
fi

tag_commit="$(git -C "$repo_root" rev-parse "refs/tags/$tag^{commit}")"
head_commit="$(git -C "$repo_root" rev-parse HEAD)"
if [ "$tag_commit" != "$head_commit" ]; then
  fail "checked-out commit $head_commit does not match $tag ($tag_commit)."
fi

if [ ! -f "$pom_file" ]; then
  fail "POM does not exist: $pom_file."
fi

version="${tag#v}"
pom_version="$(awk '
  index($0, "<version>") {
    value = substr($0, index($0, "<version>") + length("<version>"))
    value = substr(value, 1, index(value, "</version>") - 1)
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
    print value
    exit
  }
' "$pom_file")"
if [ -z "$pom_version" ]; then
  fail "could not read the project version from $pom_file."
fi
if [ "$pom_version" != "$version" ]; then
  fail "tag version $version does not match POM version $pom_version."
fi

if [ -n "$release_notes_output" ]; then
  output_dir="$(dirname "$release_notes_output")"
  if [ ! -d "$output_dir" ]; then
    fail "release notes output directory does not exist: $output_dir."
  fi
  temporary_output="${release_notes_output}.tmp.$$"
  trap 'rm -f "$temporary_output"' EXIT
  "$script_dir/extract-release-note.sh" "$version" "$notes_file" > "$temporary_output"
  mv "$temporary_output" "$release_notes_output"
  trap - EXIT
else
  "$script_dir/extract-release-note.sh" "$version" "$notes_file" >/dev/null
fi

echo "Release context OK: $tag -> $tag_commit (version $version)."
