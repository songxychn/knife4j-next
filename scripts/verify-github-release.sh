#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 3 ]; then
  echo "Usage: $0 <tag> [expected-body-file] [repo]" >&2
  exit 2
fi

tag="$1"
expected_body_file="${2:-}"
repo="${3:-${GITHUB_REPOSITORY:-}}"

if [ -z "$repo" ]; then
  echo "Repository is required; pass owner/name or set GITHUB_REPOSITORY." >&2
  exit 2
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI 'gh' is required to verify GitHub Release." >&2
  exit 1
fi

if ! gh release view "$tag" --repo "$repo" --json tagName,name >/dev/null; then
  echo "GitHub Release does not exist for tag $tag in $repo." >&2
  exit 1
fi

if [ -n "$expected_body_file" ]; then
  if [ ! -f "$expected_body_file" ]; then
    echo "Expected release body file not found: $expected_body_file" >&2
    exit 1
  fi

  actual_body="$(mktemp)"
  gh release view "$tag" --repo "$repo" --json body --jq .body > "$actual_body"
  if ! diff -u "$expected_body_file" "$actual_body"; then
    echo "GitHub Release body differs from expected release notes for $tag." >&2
    exit 1
  fi
fi

echo "GitHub Release OK: $repo@$tag"
