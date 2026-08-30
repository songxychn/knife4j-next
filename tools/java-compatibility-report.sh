#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${JAVA_COMPATIBILITY_REPO_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
OUTPUT_DIR="${JAVA_COMPATIBILITY_OUTPUT_DIR:-$REPO_ROOT/build/reports/java-compatibility}"
BASELINE_FILE="${JAVA_COMPATIBILITY_BASELINE_FILE:-$REPO_ROOT/tools/java-compatibility-baseline.properties}"
CENTRAL_BASE_URL="${JAVA_COMPATIBILITY_CENTRAL_BASE_URL:-https://repo.maven.apache.org/maven2}"
CURL_BIN="${JAVA_COMPATIBILITY_CURL_BIN:-curl}"
CURL_CONNECT_TIMEOUT_SECONDS="${JAVA_COMPATIBILITY_CONNECT_TIMEOUT_SECONDS:-10}"
CURL_REQUEST_TIMEOUT_SECONDS="${JAVA_COMPATIBILITY_REQUEST_TIMEOUT_SECONDS:-60}"
JAVA_BIN="${JAVA_COMPATIBILITY_JAVA_BIN:-java}"
PYTHON_BIN="${JAVA_COMPATIBILITY_PYTHON_BIN:-python3}"
JAPICMP_JAR="${JAVA_COMPATIBILITY_TOOL_JAR:-}"

mkdir -p "$OUTPUT_DIR/modules"
printf 'running\n' > "$OUTPUT_DIR/state.txt"
report_complete=false
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/knife4j-java-compat.XXXXXX")"
cleanup() {
  status=$?
  if [ "$report_complete" = true ]; then
    printf 'complete\n' > "$OUTPUT_DIR/state.txt"
  else
    printf 'failed (exit %s)\n' "$status" > "$OUTPUT_DIR/state.txt"
  fi
  rm -rf "$work_dir"
}
trap cleanup EXIT

property() {
  key=$1
  value="$(awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print }' "$BASELINE_FILE")"
  if [ -z "$value" ] || [ "$(printf '%s\n' "$value" | wc -l | tr -d ' ')" -ne 1 ]; then
    echo "Expected exactly one non-empty $key in $BASELINE_FILE" >&2
    exit 1
  fi
  printf '%s\n' "$value"
}

baseline_version="$(property baseline.version)"
japicmp_version="$(property japicmp.version)"
japicmp_sha256="${JAVA_COMPATIBILITY_TOOL_SHA256:-$(property japicmp.sha256)}"

if [[ ! "$baseline_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "baseline.version must be a stable X.Y.Z version: $baseline_version" >&2
  exit 1
fi
if [[ ! "$japicmp_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "japicmp.version must use X.Y.Z: $japicmp_version" >&2
  exit 1
fi
case "$japicmp_sha256" in
  *[!0-9a-fA-F]*|'') echo "Invalid japicmp.sha256: $japicmp_sha256" >&2; exit 1 ;;
esac
if [ "${#japicmp_sha256}" -ne 64 ]; then
  echo "Invalid japicmp.sha256 length: ${#japicmp_sha256}" >&2
  exit 1
fi
case "$CURL_CONNECT_TIMEOUT_SECONDS:$CURL_REQUEST_TIMEOUT_SECONDS" in
  *[!0-9:]*|:*|*:) echo "Compatibility download timeouts must be positive integers" >&2; exit 1 ;;
esac
if [ "$CURL_CONNECT_TIMEOUT_SECONDS" -eq 0 ] || [ "$CURL_REQUEST_TIMEOUT_SECONDS" -eq 0 ]; then
  echo "Compatibility download timeouts must be positive integers" >&2
  exit 1
fi

read_pom_value() {
  pom_file=$1
  element=$2
  default_value=${3:-}
  "$PYTHON_BIN" - "$pom_file" "$element" "$default_value" <<'PY'
import sys
import xml.etree.ElementTree as ET

path, element, default = sys.argv[1:]
root = ET.parse(path).getroot()
namespace = root.tag.split("}", 1)[0] + "}" if root.tag.startswith("{") else ""
node = root.find(namespace + element)
value = (node.text or "").strip() if node is not None else ""
if not value:
    value = default
if not value:
    raise SystemExit(f"POM {path} has no project {element}")
print(value)
PY
}

root_pom="$REPO_ROOT/knife4j/pom.xml"
group_id="$(read_pom_value "$root_pom" groupId)"
current_version="$(read_pom_value "$root_pom" version)"
if [[ ! "$group_id" =~ ^[A-Za-z0-9_]+(\.[A-Za-z0-9_-]+)+$ ]]; then
  echo "Invalid project groupId: $group_id" >&2
  exit 1
fi
if [[ ! "$current_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z]+)*$ ]]; then
  echo "Invalid project version: $current_version" >&2
  exit 1
fi
group_path="$(printf '%s' "$group_id" | tr . /)"

download() {
  url=$1
  destination=$2
  "$CURL_BIN" --fail --silent --show-error --location --retry 3 \
    --connect-timeout "$CURL_CONNECT_TIMEOUT_SECONDS" \
    --max-time "$CURL_REQUEST_TIMEOUT_SECONDS" \
    --output "$destination" "$url"
}

if [ -z "$JAPICMP_JAR" ]; then
  JAPICMP_JAR="$work_dir/japicmp-$japicmp_version-jar-with-dependencies.jar"
  download "$CENTRAL_BASE_URL/com/github/siom79/japicmp/japicmp/$japicmp_version/japicmp-$japicmp_version-jar-with-dependencies.jar" "$JAPICMP_JAR"
fi
if [ ! -f "$JAPICMP_JAR" ]; then
  echo "japicmp tool JAR is missing: $JAPICMP_JAR" >&2
  exit 1
fi
actual_tool_sha256="$($PYTHON_BIN - "$JAPICMP_JAR" <<'PY'
import hashlib
import sys

digest = hashlib.sha256()
with open(sys.argv[1], "rb") as handle:
    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
        digest.update(chunk)
print(digest.hexdigest())
PY
)"
if [ "$actual_tool_sha256" != "$japicmp_sha256" ]; then
  echo "japicmp checksum mismatch: expected $japicmp_sha256, got $actual_tool_sha256" >&2
  exit 1
fi

normalized_digest() {
  "$PYTHON_BIN" - "$1" <<'PY'
import hashlib
import sys
import zipfile

archive_digest = hashlib.sha256()
with zipfile.ZipFile(sys.argv[1]) as archive:
    entries = sorted((item for item in archive.infolist() if not item.is_dir()), key=lambda item: item.filename)
    for item in entries:
        name = item.filename
        upper = name.upper()
        if upper == "META-INF/MANIFEST.MF":
            continue
        if name.startswith("META-INF/maven/") and name.endswith("/pom.properties"):
            continue
        content = archive.read(item)
        archive_digest.update(name.encode("utf-8"))
        archive_digest.update(b"\0")
        archive_digest.update(hashlib.sha256(content).digest())
print(archive_digest.hexdigest())
PY
}

archive_diff() {
  "$PYTHON_BIN" - "$1" "$2" "$3" <<'PY'
import hashlib
import sys
import zipfile


def entries(path):
    result = {}
    with zipfile.ZipFile(path) as archive:
        for item in archive.infolist():
            if item.is_dir():
                continue
            name = item.filename
            upper = name.upper()
            if upper == "META-INF/MANIFEST.MF":
                continue
            if name.startswith("META-INF/maven/") and name.endswith("/pom.properties"):
                continue
            if name in result:
                raise SystemExit(f"duplicate archive entry in {path}: {name}")
            result[name] = hashlib.sha256(archive.read(item)).hexdigest()
    return result


baseline = entries(sys.argv[1])
current = entries(sys.argv[2])
baseline_only = sorted(baseline.keys() - current.keys())
current_only = sorted(current.keys() - baseline.keys())
changed = sorted(name for name in baseline.keys() & current.keys() if baseline[name] != current[name])
lines = [
    f"baseline-only\t{len(baseline_only)}",
    f"current-only\t{len(current_only)}",
    f"content-changed\t{len(changed)}",
]
for label, names in (("baseline-only", baseline_only), ("current-only", current_only), ("content-changed", changed)):
    lines.extend(f"{label}\t{name}" for name in names)
with open(sys.argv[3], "w", encoding="utf-8") as handle:
    handle.write("\n".join(lines) + "\n")
PY
}

records="$OUTPUT_DIR/modules.tsv"
printf 'module\tpackaging\tbaseline_digest\tcurrent_digest\txml_report\tmarkdown_report\tarchive_report\n' > "$records"
module_count=0
while IFS= read -r raw_line || [ -n "$raw_line" ]; do
  module="${raw_line%%#*}"
  module="$(printf '%s' "$module" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  [ -n "$module" ] || continue
  if [[ ! "$module" =~ ^[A-Za-z0-9_.-]+$ ]] || [ "$module" = . ] || [ "$module" = .. ]; then
    echo "Invalid release module name: $module" >&2
    exit 1
  fi
  module_count=$((module_count + 1))
  module_pom="$REPO_ROOT/knife4j/$module/pom.xml"
  if [ ! -f "$module_pom" ]; then
    echo "Release module POM is missing: $module_pom" >&2
    exit 1
  fi
  packaging="$(read_pom_value "$module_pom" packaging jar)"
  if [ "$packaging" = pom ]; then
    printf '%s\tpom\t-\t-\t-\t-\t-\n' "$module" >> "$records"
    continue
  fi
  if [ "$packaging" != jar ]; then
    echo "Unsupported release packaging for $module: $packaging" >&2
    exit 1
  fi

  current_jar="$REPO_ROOT/knife4j/$module/target/$module-$current_version.jar"
  if [ ! -f "$current_jar" ]; then
    echo "Built release JAR is missing: $current_jar" >&2
    exit 1
  fi
  baseline_jar="$work_dir/$module-$baseline_version-central.jar"
  download "$CENTRAL_BASE_URL/$group_path/$module/$baseline_version/$module-$baseline_version.jar" "$baseline_jar"
  if [ "$baseline_jar" -ef "$current_jar" ]; then
    echo "Baseline and current JAR unexpectedly resolve to the same file: $module" >&2
    exit 1
  fi

  xml_relative="modules/$module.xml"
  markdown_relative="modules/$module.md"
  archive_relative="modules/$module-archive.tsv"
  "$JAVA_BIN" -jar "$JAPICMP_JAR" \
    --old "$baseline_jar" \
    --new "$current_jar" \
    --only-modified \
    --markdown \
    --ignore-missing-classes \
    --xml-file "$OUTPUT_DIR/$xml_relative" \
    --report-only-filename > "$OUTPUT_DIR/$markdown_relative"

  baseline_digest="$(normalized_digest "$baseline_jar")"
  current_digest="$(normalized_digest "$current_jar")"
  archive_diff "$baseline_jar" "$current_jar" "$OUTPUT_DIR/$archive_relative"
  printf '%s\tjar\t%s\t%s\t%s\t%s\t%s\n' \
    "$module" "$baseline_digest" "$current_digest" "$xml_relative" "$markdown_relative" "$archive_relative" >> "$records"
done < "$REPO_ROOT/tools/release-modules.txt"

if [ "$module_count" -eq 0 ]; then
  echo "Release module list is empty" >&2
  exit 1
fi

"$PYTHON_BIN" "$REPO_ROOT/tools/java-compatibility-summary.py" \
  --records "$records" \
  --output-dir "$OUTPUT_DIR" \
  --baseline-version "$baseline_version" \
  --current-version "$current_version"

if [ "${JAVA_COMPATIBILITY_SKIP_CONTRACTS:-false}" != true ]; then
  "$PYTHON_BIN" "$REPO_ROOT/tools/verify-java-compatibility-contracts.py" --repo-root "$REPO_ROOT"
fi

report_complete=true
printf 'Java compatibility report: %s/summary.md\n' "$OUTPUT_DIR"
