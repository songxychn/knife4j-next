#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

specs=(
  "knife4j-openapi2-spring-boot-starter|knife4j.enable|knife4j.production"
  "knife4j-openapi3-spring-boot-starter|knife4j.enable|knife4j.production"
  "knife4j-openapi3-jakarta-spring-boot-starter|knife4j.enable|knife4j.production"
  "knife4j-aggregation-spring-boot-starter|knife4j.enable-aggregation"
  "knife4j-aggregation-jakarta-spring-boot-starter|knife4j.enable-aggregation"
  "knife4j-gateway-spring-boot-starter|knife4j.gateway.enabled"
)

tmp_metadata="$(mktemp)"
trap 'rm -f "$tmp_metadata"' EXIT

failures=()

echo "==> Verifying Spring Boot configuration metadata"
for spec in "${specs[@]}"; do
  IFS='|' read -r module key1 key2 <<< "$spec"
  target_dir="$repo_root/knife4j/$module/target"
  jars=()

  for candidate in "$target_dir"/"$module"-*.jar; do
    if [ ! -e "$candidate" ]; then
      continue
    fi
    case "$(basename "$candidate")" in
      *-sources.jar|*-javadoc.jar|*-tests.jar)
        continue
        ;;
    esac
    jars+=("$candidate")
  done

  if [ "${#jars[@]}" -ne 1 ]; then
    echo "   [MISSING] $module: expected one binary JAR under $target_dir, found ${#jars[@]}"
    failures+=("$module")
    continue
  fi

  jar_file="${jars[0]}"
  if ! unzip -p "$jar_file" META-INF/spring-configuration-metadata.json > "$tmp_metadata" 2>/dev/null; then
    echo "   [MISSING] $module: META-INF/spring-configuration-metadata.json"
    failures+=("$module")
    continue
  fi

  normalized="$(tr -d '[:space:]' < "$tmp_metadata")"
  missing_keys=()
  for key in "$key1" "${key2:-}"; do
    if [ -z "$key" ]; then
      continue
    fi
    case "$normalized" in
      *"\"name\":\"$key\""*)
        ;;
      *)
        missing_keys+=("$key")
        ;;
    esac
  done

  if [ "${#missing_keys[@]}" -ne 0 ]; then
    echo "   [INVALID] $module: missing properties ${missing_keys[*]}"
    failures+=("$module")
    continue
  fi

  echo "   [OK]      $module: $(basename "$jar_file")"
done

if [ "${#failures[@]}" -ne 0 ]; then
  echo "" >&2
  echo "Configuration metadata verification failed for: ${failures[*]}" >&2
  exit 1
fi

echo "==> Configuration metadata OK (${#specs[@]} modules)"
