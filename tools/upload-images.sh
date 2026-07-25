#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "Usage: $0 <image> [image...]" >&2
  exit 2
fi

for command in curl file jq; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "$command is required." >&2
    exit 1
  fi
done

files=()
for image in "$@"; do
  if [ ! -f "$image" ]; then
    echo "Image not found: $image" >&2
    exit 1
  fi
  if [[ "$(file -b --mime-type "$image")" != image/* ]]; then
    echo "Not an image: $image" >&2
    exit 1
  fi
  files+=("$(cd "$(dirname "$image")" && pwd -P)/$(basename "$image")")
done

payload="$(jq -nc --args '$ARGS.positional | {list: .}' -- "${files[@]}")"
response="$(
  curl --noproxy '127.0.0.1,localhost' --silent --show-error --fail \
    --connect-timeout 2 --max-time 60 \
    --header 'Content-Type: application/json' \
    --data "$payload" \
    'http://127.0.0.1:36677/upload?picbed=aws-s3-plist&configName=knife4j-next'
)"

if ! jq -e '.success == true and (.result | type == "array")' >/dev/null <<<"$response"; then
  jq -r '.message // "PicGo upload failed."' <<<"$response" >&2
  exit 1
fi

urls=()
while IFS= read -r url; do
  urls+=("$url")
done < <(jq -r '.result[]' <<<"$response")

if [ "${#urls[@]}" -ne "${#files[@]}" ]; then
  echo "PicGo returned an unexpected number of URLs." >&2
  exit 1
fi

for index in "${!files[@]}"; do
  url="${urls[$index]}"
  if [[ "$url" != https://* ]]; then
    echo "PicGo returned a non-HTTPS URL." >&2
    exit 1
  fi
  if ! curl --silent --show-error --fail --location \
    --proto '=https' --proto-redir '=https' \
    --max-time 60 --output /dev/null "$url"; then
    echo "Uploaded URL is not publicly readable: $url" >&2
    exit 1
  fi
done

for index in "${!files[@]}"; do
  url="${urls[$index]}"
  alt="$(basename "${files[$index]}")"
  alt="${alt//\\/\\\\}"
  alt="${alt//]/\\]}"
  alt="${alt//$'\n'/ }"
  alt="${alt//$'\r'/ }"
  printf '![%s](%s)\n' "$alt" "$url"
done
