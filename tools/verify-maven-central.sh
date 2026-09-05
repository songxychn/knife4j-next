#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <version>" >&2
  exit 2
fi

version="$1"
if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Version must match X.Y.Z, got '$version'." >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="${VERIFY_MAVEN_REPO_ROOT:-$(cd "$script_dir/.." && pwd)}"
modules_file="${VERIFY_MAVEN_MODULES_FILE:-$repo_root/tools/release-modules.txt}"
parent_pom="${VERIFY_MAVEN_PARENT_POM:-$repo_root/knife4j/pom.xml}"
base_url="${MAVEN_CENTRAL_BASE_URL:-https://repo.maven.apache.org/maven2}"
max_attempts="${MAVEN_CENTRAL_MAX_ATTEMPTS:-31}"
retry_interval="${MAVEN_CENTRAL_RETRY_INTERVAL_SECONDS:-60}"
network_retry_interval="${MAVEN_CENTRAL_NETWORK_RETRY_INTERVAL_SECONDS:-2}"
connect_timeout="${MAVEN_CENTRAL_CONNECT_TIMEOUT_SECONDS:-10}"
request_timeout="${MAVEN_CENTRAL_REQUEST_TIMEOUT_SECONDS:-30}"
curl_bin="${MAVEN_CENTRAL_CURL_BIN:-curl}"
jar_bin="${MAVEN_CENTRAL_JAR_BIN:-jar}"

require_non_negative_integer() {
  local name="$1"
  local value="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]]; then
    echo "$name must be a non-negative integer, got '$value'." >&2
    exit 2
  fi
}

require_positive_integer() {
  local name="$1"
  local value="$2"
  require_non_negative_integer "$name" "$value"
  if [ "$value" -eq 0 ]; then
    echo "$name must be greater than zero." >&2
    exit 2
  fi
}

require_positive_integer "MAVEN_CENTRAL_MAX_ATTEMPTS" "$max_attempts"
require_non_negative_integer "MAVEN_CENTRAL_RETRY_INTERVAL_SECONDS" "$retry_interval"
require_non_negative_integer "MAVEN_CENTRAL_NETWORK_RETRY_INTERVAL_SECONDS" "$network_retry_interval"
require_positive_integer "MAVEN_CENTRAL_CONNECT_TIMEOUT_SECONDS" "$connect_timeout"
require_positive_integer "MAVEN_CENTRAL_REQUEST_TIMEOUT_SECONDS" "$request_timeout"

if [ ! -x "$curl_bin" ] && ! command -v "$curl_bin" >/dev/null 2>&1; then
  echo "curl executable is required: $curl_bin" >&2
  exit 1
fi
if [ ! -x "$jar_bin" ] && ! command -v "$jar_bin" >/dev/null 2>&1; then
  echo "jar executable is required to inspect UI archives: $jar_bin" >&2
  exit 1
fi
if [ ! -f "$modules_file" ]; then
  echo "Release module list not found: $modules_file" >&2
  exit 1
fi
if [ ! -f "$parent_pom" ]; then
  echo "Parent POM not found: $parent_pom" >&2
  exit 1
fi

first_xml_value() {
  local element="$1"
  local file="$2"
  awk -v start="<$element>" -v finish="</$element>" '
    index($0, start) {
      value = substr($0, index($0, start) + length(start))
      value = substr(value, 1, index(value, finish) - 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      print value
      exit
    }
  ' "$file"
}

group_id="$(first_xml_value groupId "$parent_pom")"
parent_artifact="$(first_xml_value artifactId "$parent_pom")"
if [ -z "$group_id" ] || [ -z "$parent_artifact" ]; then
  echo "Could not read groupId/artifactId from $parent_pom" >&2
  exit 1
fi

group_path="$(printf '%s' "$group_id" | tr '.' '/')"
base_url="${base_url%/}"

expected_modules=()
expected_files=()
expected_urls=()
ui_modules=()
ui_files=()
ui_urls=()

add_primary_artifact() {
  local artifact="$1"
  local filename="$2"
  local artifact_url="$base_url/$group_path/$artifact/$version/$filename"
  local suffix

  for suffix in "" ".asc" ".sha1"; do
    expected_modules+=("$artifact")
    expected_files+=("$filename$suffix")
    expected_urls+=("$artifact_url$suffix")
  done
}

add_primary_artifact "$parent_artifact" "$parent_artifact-$version.pom"

release_modules=()
while IFS= read -r line; do
  line="${line%%#*}"
  line="$(printf '%s' "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  if [ -n "$line" ]; then
    release_modules+=("$line")
  fi
done < "$modules_file"

if [ "${#release_modules[@]}" -eq 0 ]; then
  echo "Release module list is empty: $modules_file" >&2
  exit 1
fi

for module in "${release_modules[@]}"; do
  module_pom="$repo_root/knife4j/$module/pom.xml"
  if [ ! -f "$module_pom" ]; then
    echo "Module POM not found: $module_pom" >&2
    exit 1
  fi

  packaging="$(first_xml_value packaging "$module_pom")"
  if [ -z "$packaging" ]; then
    packaging="jar"
  fi

  add_primary_artifact "$module" "$module-$version.pom"
  if [ "$packaging" != "pom" ]; then
    primary_file="$module-$version.$packaging"
    add_primary_artifact "$module" "$primary_file"
    case "$module:$packaging" in
      *-ui:jar)
        ui_modules+=("$module")
        ui_files+=("$primary_file")
        ui_urls+=("$base_url/$group_path/$module/$version/$primary_file")
        ;;
    esac
  fi
done

temporary_dir="$(mktemp -d)"
trap 'rm -rf "$temporary_dir"' EXIT
probe_error=""
probe_network_error=false

record_curl_failure() {
  local http_code="$1"
  local curl_status="$2"
  local error_file="$3"
  local error_text=""

  # Keep HTTP errors, certificate validation and local/configuration failures on
  # the normal interval. Only transport failures qualify for the shorter wait.
  case "$curl_status" in
    5|6|7|16|18|28|35|52|55|56|92) probe_network_error=true ;;
  esac
  if [ -s "$error_file" ]; then
    error_text="$(tr '\n' ' ' < "$error_file" | sed 's/[[:space:]]*$//')"
  fi
  if [ -n "$http_code" ] && [ "$http_code" != "000" ]; then
    probe_error="HTTP $http_code (curl $curl_status)"
  else
    probe_error="curl $curl_status"
  fi
  if [ -n "$error_text" ]; then
    probe_error="$probe_error: $error_text"
  fi
}

probe_url() {
  local url="$1"
  local error_file="$temporary_dir/curl-error"
  local http_code=""
  local curl_status=0
  probe_network_error=false

  if http_code="$("$curl_bin" \
    --fail \
    --location \
    --silent \
    --show-error \
    --range 0-0 \
    --connect-timeout "$connect_timeout" \
    --max-time "$request_timeout" \
    --output /dev/null \
    --write-out '%{http_code}' \
    "$url" 2> "$error_file")"; then
    if [[ "$http_code" =~ ^2[0-9][0-9]$ ]]; then
      probe_error=""
      return 0
    fi
    probe_error="HTTP ${http_code:-unknown}"
    return 1
  else
    curl_status=$?
  fi

  record_curl_failure "$http_code" "$curl_status" "$error_file"
  return 1
}

download_and_inspect_ui() {
  local filename="$2"
  local url="$3"
  local target="$temporary_dir/$filename"
  local error_file="$temporary_dir/curl-error"
  local http_code=""
  local curl_status=0
  probe_network_error=false

  if http_code="$("$curl_bin" \
    --fail \
    --location \
    --silent \
    --show-error \
    --connect-timeout "$connect_timeout" \
    --max-time "$request_timeout" \
    --output "$target" \
    --write-out '%{http_code}' \
    "$url" 2> "$error_file")"; then
    if [[ "$http_code" =~ ^2[0-9][0-9]$ ]]; then
      if "$jar_bin" tf "$target" >/dev/null 2>&1; then
        probe_error=""
        return 0
      fi
      probe_error="downloaded UI JAR is unreadable"
      return 1
    fi
    probe_error="HTTP ${http_code:-unknown}"
    return 1
  else
    curl_status=$?
  fi

  record_curl_failure "$http_code" "$curl_status" "$error_file"
  return 1
}

# This evidence is local to this invocation/version/URL, never persisted or
# shared between jobs. A successful probe does not verify UI JAR readability.
verified_files=()
verified_ui=()
attempt=1
while [ "$attempt" -le "$max_attempts" ]; do
  missing_modules=()
  missing_files=()
  missing_errors=()
  only_network_errors=true

  for index in "${!expected_urls[@]}"; do
    if [ "${verified_files[$index]:-false}" = true ]; then
      continue
    fi
    if probe_url "${expected_urls[$index]}"; then
      verified_files[$index]=true
    else
      missing_modules+=("${expected_modules[$index]}")
      missing_files+=("${expected_files[$index]}")
      missing_errors+=("$probe_error")
      if [ "$probe_network_error" != true ]; then
        only_network_errors=false
      fi
    fi
  done

  if [ "${#missing_files[@]}" -eq 0 ]; then
    for index in "${!ui_urls[@]}"; do
      if [ "${verified_ui[$index]:-false}" = true ]; then
        continue
      fi
      if download_and_inspect_ui "${ui_modules[$index]}" "${ui_files[$index]}" "${ui_urls[$index]}"; then
        verified_ui[$index]=true
      else
        missing_modules+=("${ui_modules[$index]}")
        missing_files+=("${ui_files[$index]} (readability)")
        missing_errors+=("$probe_error")
        if [ "$probe_network_error" != true ]; then
          only_network_errors=false
        fi
      fi
    done
  fi

  if [ "${#missing_files[@]}" -eq 0 ]; then
    echo "Maven Central artifacts OK: $group_id:$version (${#expected_files[@]} exact files, ${#ui_files[@]} UI JARs readable, attempt $attempt/$max_attempts)."
    exit 0
  fi

  wait_seconds="$retry_interval"
  failure_kind="artifacts unavailable or unreadable"
  if [ "$only_network_errors" = true ]; then
    # Preserve an existing caller's tighter normal interval (including zero).
    if [ "$network_retry_interval" -lt "$wait_seconds" ]; then
      wait_seconds="$network_retry_interval"
    fi
    failure_kind="network/transfer failures"
  fi
  echo "Maven Central verification incomplete (attempt $attempt/$max_attempts): ${#missing_files[@]} file(s); $failure_kind." >&2
  for index in "${!missing_files[@]}"; do
    printf '  - %s: %s (%s)\n' \
      "${missing_modules[$index]}" \
      "${missing_files[$index]}" \
      "${missing_errors[$index]}" >&2
  done

  if [ "$attempt" -eq "$max_attempts" ]; then
    echo "::error::Maven Central verification timed out after $attempt attempt(s)." >&2
    failed_modules="$(printf '%s\n' "${missing_modules[@]}" | sort -u | paste -sd, -)"
    echo "::error::Unavailable modules/artifacts: $failed_modules" >&2
    exit 1
  fi

  echo "Maven Central: retrying in ${wait_seconds}s (pending files only)." >&2
  if [ "$wait_seconds" -gt 0 ]; then
    sleep "$wait_seconds"
  fi
  attempt=$((attempt + 1))
done
