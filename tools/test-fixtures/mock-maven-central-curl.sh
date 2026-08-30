#!/usr/bin/env bash
set -euo pipefail

: "${MOCK_CURL_STATE_DIR:?MOCK_CURL_STATE_DIR is required}"
: "${MOCK_CURL_PLAN:?MOCK_CURL_PLAN is required}"
: "${MOCK_CURL_VALID_JAR:?MOCK_CURL_VALID_JAR is required}"

output_file="/dev/null"
is_head=false
url=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --output|-o)
      output_file="$2"
      shift 2
      ;;
    --write-out|-w|--connect-timeout|--max-time|--range)
      shift 2
      ;;
    --head|-I)
      is_head=true
      shift
      ;;
    --fail|--location|--silent|--show-error)
      shift
      ;;
    --*)
      echo "unsupported mock curl option: $1" >&2
      exit 2
      ;;
    *)
      url="$1"
      shift
      ;;
  esac
done

if [ -z "$url" ]; then
  echo "mock curl URL is required" >&2
  exit 2
fi

mkdir -p "$MOCK_CURL_STATE_DIR"
printf '%s\t%s\n' "$is_head" "$url" >> "$MOCK_CURL_STATE_DIR/requests.log"

key="$(printf '%s' "$url" | cksum | awk '{print $1}')"
count_file="$MOCK_CURL_STATE_DIR/$key.count"
count=0
if [ -f "$count_file" ]; then
  count="$(sed -n '1p' "$count_file")"
fi
count=$((count + 1))
printf '%s\n' "$count" > "$count_file"

while IFS='|' read -r pattern failure_count http_code exit_status message; do
  if [ -z "$pattern" ]; then
    continue
  fi
  if [[ "$url" == *"$pattern"* ]] && [ "$count" -le "$failure_count" ]; then
    printf '%s' "$http_code"
    if [ -n "$message" ]; then
      printf '%s\n' "$message" >&2
    fi
    exit "$exit_status"
  fi
done < "$MOCK_CURL_PLAN"

if [ "$is_head" = false ] && [ "$output_file" != "/dev/null" ]; then
  if [ -n "${MOCK_CURL_INVALID_JAR_PATTERN:-}" ] && [[ "$url" == *"$MOCK_CURL_INVALID_JAR_PATTERN"* ]]; then
    printf 'not a jar\n' > "$output_file"
  else
    cp "$MOCK_CURL_VALID_JAR" "$output_file"
  fi
fi

printf '200'
