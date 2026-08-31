#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 3 ]; then
  echo "Usage: $0 <tag> [expected-body-file] [repo]" >&2
  exit 2
fi

tag="$1"
expected_body_file="${2:-}"
repo="${3:-${GITHUB_REPOSITORY:-}}"
gh_bin="${GITHUB_RELEASE_GH_BIN:-gh}"
require_latest="${VERIFY_GITHUB_RELEASE_REQUIRE_LATEST:-false}"

if [ -z "$repo" ]; then
  echo "Repository is required; pass owner/name or set GITHUB_REPOSITORY." >&2
  exit 2
fi

if [ ! -x "$gh_bin" ] && ! command -v "$gh_bin" >/dev/null 2>&1; then
  echo "GitHub CLI is required to verify GitHub Release: $gh_bin" >&2
  exit 1
fi

release_metadata=""
if ! release_metadata="$("$gh_bin" release view "$tag" \
  --repo "$repo" \
  --json tagName,isDraft,isPrerelease \
  --jq '[.tagName, .isDraft, .isPrerelease] | @tsv')"; then
  echo "GitHub Release does not exist for tag $tag in $repo." >&2
  exit 1
fi

IFS=$'\t' read -r actual_tag is_draft is_prerelease <<< "$release_metadata"
if [ "$actual_tag" != "$tag" ]; then
  echo "GitHub Release tag mismatch: expected $tag, got ${actual_tag:-<empty>}." >&2
  exit 1
fi
if [ "$is_draft" = "true" ]; then
  echo "GitHub Release for $tag is still a draft." >&2
  exit 1
fi
if [ "$is_prerelease" = "true" ]; then
  echo "GitHub Release for $tag is a prerelease." >&2
  exit 1
fi

case "$require_latest" in
  true)
    latest_tag=""
    if ! latest_tag="$("$gh_bin" release view --repo "$repo" --json tagName --jq '.tagName')"; then
      echo "Could not resolve the current latest GitHub Release in $repo." >&2
      exit 1
    fi
    if [ "$latest_tag" != "$tag" ]; then
      echo "Refusing to deploy $tag because the current latest GitHub Release is ${latest_tag:-<empty>}." >&2
      exit 1
    fi
    ;;
  false)
    ;;
  *)
    echo "VERIFY_GITHUB_RELEASE_REQUIRE_LATEST must be true or false, got '$require_latest'." >&2
    exit 2
    ;;
esac

if [ -n "$expected_body_file" ]; then
  if [ ! -f "$expected_body_file" ]; then
    echo "Expected release body file not found: $expected_body_file" >&2
    exit 1
  fi

  actual_body="$(mktemp)"
  trap 'rm -f "$actual_body"' EXIT
  "$gh_bin" release view "$tag" --repo "$repo" --json body --template '{{.body}}' > "$actual_body"
  if ! diff -u "$expected_body_file" "$actual_body"; then
    echo "GitHub Release body differs from expected release notes for $tag." >&2
    exit 1
  fi
  rm -f "$actual_body"
  trap - EXIT
fi

echo "GitHub Release OK: $repo@$tag"
