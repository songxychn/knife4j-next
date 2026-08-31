#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ] || [ "$1" != "release" ] || [ "$2" != "view" ]; then
  echo "mock gh only supports: release view" >&2
  exit 2
fi
shift 2

requested_tag=""
if [ "$#" -gt 0 ] && [[ "$1" != --* ]]; then
  requested_tag="$1"
  shift
fi

json_fields=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --json)
      json_fields="$2"
      shift 2
      ;;
    --repo|--jq|--template)
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

state="${MOCK_GH_RELEASE_STATE:-published}"
if [ "$state" = "missing" ]; then
  exit 1
fi

case "$json_fields" in
  tagName,isDraft,isPrerelease)
    actual_tag="${MOCK_GH_RELEASE_TAG:-$requested_tag}"
    is_draft=false
    is_prerelease=false
    case "$state" in
      published)
        ;;
      draft)
        is_draft=true
        ;;
      prerelease)
        is_prerelease=true
        ;;
      *)
        echo "unsupported MOCK_GH_RELEASE_STATE: $state" >&2
        exit 2
        ;;
    esac
    printf '%s\t%s\t%s\n' "$actual_tag" "$is_draft" "$is_prerelease"
    ;;
  tagName)
    printf '%s\n' "${MOCK_GH_LATEST_TAG:-${MOCK_GH_RELEASE_TAG:-$requested_tag}}"
    ;;
  body)
    if [ -n "${MOCK_GH_RELEASE_BODY_FILE:-}" ]; then
      /bin/cat "$MOCK_GH_RELEASE_BODY_FILE"
    fi
    ;;
  *)
    echo "unsupported --json fields: $json_fields" >&2
    exit 2
    ;;
esac
