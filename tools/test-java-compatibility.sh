#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
python_bin="${JAVA_COMPATIBILITY_PYTHON_BIN:-python3}"
javac_bin="${JAVA_COMPATIBILITY_JAVAC_BIN:-javac}"
fixture_root="$(mktemp -d "${TMPDIR:-/tmp}/knife4j-java-compat-test.XXXXXX")"
trap 'rm -rf "$fixture_root"' EXIT

assert_contains() {
  file=$1
  expected=$2
  if ! grep -Fq "$expected" "$file"; then
    echo "Expected $file to contain: $expected" >&2
    exit 1
  fi
}

report_repo="$fixture_root/report-repo"
mkdir -p "$report_repo/tools" "$report_repo/knife4j"
cp "$repo_root/tools/java-compatibility-summary.py" "$report_repo/tools/"
printf '%s\n' \
  api-breaking \
  api-compatible \
  resource-only \
  bom > "$report_repo/tools/release-modules.txt"
cat > "$report_repo/knife4j/pom.xml" <<'XML'
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>test.example</groupId>
  <artifactId>fixture</artifactId>
  <version>2.0.0</version>
</project>
XML

for module in api-breaking api-compatible resource-only; do
  mkdir -p "$report_repo/knife4j/$module/target"
  cat > "$report_repo/knife4j/$module/pom.xml" <<XML
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <artifactId>$module</artifactId>
</project>
XML
done
mkdir -p "$report_repo/knife4j/bom"
cat > "$report_repo/knife4j/bom/pom.xml" <<'XML'
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <artifactId>bom</artifactId>
  <packaging>pom</packaging>
</project>
XML

baseline_dir="$fixture_root/central"
mkdir -p "$baseline_dir"
"$python_bin" - "$report_repo" "$baseline_dir" <<'PY'
import sys
import zipfile
from pathlib import Path

repo = Path(sys.argv[1])
baseline = Path(sys.argv[2])
for module in ("api-breaking", "api-compatible", "resource-only"):
    with zipfile.ZipFile(baseline / f"{module}-1.0.0.jar", "w") as archive:
        archive.writestr("example/Api.class", b"baseline-" + module.encode())
    with zipfile.ZipFile(repo / "knife4j" / module / "target" / f"{module}-2.0.0.jar", "w") as archive:
        content = b"baseline-" + module.encode()
        if module == "resource-only":
            content += b"-changed"
        archive.writestr("example/Api.class", content)
PY

mock_curl="$fixture_root/mock-curl"
cat > "$mock_curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
destination=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) destination=$2; shift 2 ;;
    http://*|https://*) url=$1; shift ;;
    *) shift ;;
  esac
done
source_file="$MOCK_CENTRAL_DIR/$(basename "$url")"
if [ ! -f "$source_file" ]; then
  echo "mock Central artifact missing: $source_file" >&2
  exit 22
fi
cp "$source_file" "$destination"
SH
chmod +x "$mock_curl"

mock_java="$fixture_root/mock-java"
cat > "$mock_java" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [ "${MOCK_JAVA_FAIL:-false}" = true ]; then
  echo "simulated japicmp failure" >&2
  exit 9
fi
new_jar=""
xml_file=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --new) new_jar=$2; shift 2 ;;
    --xml-file) xml_file=$2; shift 2 ;;
    *) shift ;;
  esac
done
case "$new_jar" in
  *api-breaking*)
    change='<compatibilityChange binaryCompatible="false" sourceCompatible="false" type="METHOD_REMOVED"/>'
    status=REMOVED
    ;;
  *api-compatible*)
    change='<compatibilityChange binaryCompatible="true" sourceCompatible="true" type="METHOD_ADDED_TO_PUBLIC_CLASS"/>'
    status=NEW
    ;;
  *)
    change=''
    status=UNCHANGED
    ;;
esac
cat > "$xml_file" <<XML
<?xml version="1.0" encoding="UTF-8"?>
<japicmp><classes><class changeStatus="$status"><methods><method changeStatus="$status"><compatibilityChanges>$change</compatibilityChanges></method></methods></class></classes></japicmp>
XML
printf '# mock japicmp details\n'
SH
chmod +x "$mock_java"

tool_jar="$fixture_root/japicmp.jar"
printf 'pinned test tool\n' > "$tool_jar"
tool_sha256="$($python_bin - "$tool_jar" <<'PY'
import hashlib
import sys
print(hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest())
PY
)"
baseline_file="$fixture_root/baseline.properties"
cat > "$baseline_file" <<EOF_BASELINE
baseline.version=1.0.0
japicmp.version=0.26.1
japicmp.sha256=$tool_sha256
EOF_BASELINE

report_output="$fixture_root/report-output"
MOCK_CENTRAL_DIR="$baseline_dir" \
JAVA_COMPATIBILITY_REPO_ROOT="$report_repo" \
JAVA_COMPATIBILITY_OUTPUT_DIR="$report_output" \
JAVA_COMPATIBILITY_BASELINE_FILE="$baseline_file" \
JAVA_COMPATIBILITY_CENTRAL_BASE_URL="https://central.invalid" \
JAVA_COMPATIBILITY_CURL_BIN="$mock_curl" \
JAVA_COMPATIBILITY_JAVA_BIN="$mock_java" \
JAVA_COMPATIBILITY_PYTHON_BIN="$python_bin" \
JAVA_COMPATIBILITY_TOOL_JAR="$tool_jar" \
JAVA_COMPATIBILITY_SKIP_CONTRACTS=true \
  "$repo_root/tools/java-compatibility-report.sh"

assert_contains "$report_output/summary.md" "不兼容 API 变化 | 1"
assert_contains "$report_output/summary.md" "兼容 API 变化 | 1"
assert_contains "$report_output/summary.md" "仅实现或资源变化 | 1"
assert_contains "$report_output/summary.md" "POM 模块 | 1"
assert_contains "$report_output/state.txt" "complete"
"$python_bin" - "$report_output/summary.json" <<'PY'
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["reportOnly"] is True
assert payload["totals"]["breaking"] == 1
assert payload["totals"]["compatible"] == 1
assert payload["totals"]["implementation_only"] == 1
assert payload["totals"]["pom"] == 1
PY

failure_output="$fixture_root/failure-output"
if MOCK_JAVA_FAIL=true \
  MOCK_CENTRAL_DIR="$baseline_dir" \
  JAVA_COMPATIBILITY_REPO_ROOT="$report_repo" \
  JAVA_COMPATIBILITY_OUTPUT_DIR="$failure_output" \
  JAVA_COMPATIBILITY_BASELINE_FILE="$baseline_file" \
  JAVA_COMPATIBILITY_CENTRAL_BASE_URL="https://central.invalid" \
  JAVA_COMPATIBILITY_CURL_BIN="$mock_curl" \
  JAVA_COMPATIBILITY_JAVA_BIN="$mock_java" \
  JAVA_COMPATIBILITY_PYTHON_BIN="$python_bin" \
  JAVA_COMPATIBILITY_TOOL_JAR="$tool_jar" \
  JAVA_COMPATIBILITY_SKIP_CONTRACTS=true \
    "$repo_root/tools/java-compatibility-report.sh" > "$fixture_root/failure.stdout" 2> "$fixture_root/failure.stderr"; then
  echo "Expected japicmp infrastructure failure to fail the report" >&2
  exit 1
fi
assert_contains "$failure_output/state.txt" "failed (exit 9)"

checksum_output="$fixture_root/checksum-output"
if MOCK_CENTRAL_DIR="$baseline_dir" \
  JAVA_COMPATIBILITY_REPO_ROOT="$report_repo" \
  JAVA_COMPATIBILITY_OUTPUT_DIR="$checksum_output" \
  JAVA_COMPATIBILITY_BASELINE_FILE="$baseline_file" \
  JAVA_COMPATIBILITY_CURL_BIN="$mock_curl" \
  JAVA_COMPATIBILITY_JAVA_BIN="$mock_java" \
  JAVA_COMPATIBILITY_PYTHON_BIN="$python_bin" \
  JAVA_COMPATIBILITY_TOOL_JAR="$tool_jar" \
  JAVA_COMPATIBILITY_TOOL_SHA256="0000000000000000000000000000000000000000000000000000000000000000" \
  JAVA_COMPATIBILITY_SKIP_CONTRACTS=true \
    "$repo_root/tools/java-compatibility-report.sh" > "$fixture_root/checksum.stdout" 2> "$fixture_root/checksum.stderr"; then
  echo "Expected a japicmp checksum mismatch to fail the report" >&2
  exit 1
fi
assert_contains "$fixture_root/checksum.stderr" "japicmp checksum mismatch"

contract_repo="$fixture_root/contract-repo"
mkdir -p "$contract_repo/tools" "$contract_repo/knife4j/sample/target" \
  "$fixture_root/contract-src/example" "$fixture_root/contract-classes"
printf 'sample\n' > "$contract_repo/tools/release-modules.txt"
cat > "$contract_repo/knife4j/pom.xml" <<'XML'
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>test.example</groupId>
  <artifactId>fixture</artifactId>
  <version>1.0.0</version>
</project>
XML
cat > "$contract_repo/knife4j/sample/pom.xml" <<'XML'
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <artifactId>sample</artifactId>
</project>
XML
cat > "$fixture_root/contract-src/example/Contract.java" <<'JAVA'
package example;
public final class Contract {
  public static final String PATH = "/doc";
}
JAVA
"$javac_bin" -d "$fixture_root/contract-classes" "$fixture_root/contract-src/example/Contract.java"

build_contract_jar() {
  extra_key=$1
  "$python_bin" - "$contract_repo" "$fixture_root/contract-classes/example/Contract.class" "$extra_key" <<'PY'
import json
import sys
import zipfile
from pathlib import Path

repo = Path(sys.argv[1])
class_file = Path(sys.argv[2])
properties = [{"name": "sample.enabled", "type": "java.lang.Boolean"}]
if sys.argv[3] == "true":
    properties.append({"name": "sample.extra", "type": "java.lang.String"})
jar_file = repo / "knife4j/sample/target/sample-1.0.0.jar"
with zipfile.ZipFile(jar_file, "w") as archive:
    archive.write(class_file, "example/Contract.class")
    archive.writestr("META-INF/spring-configuration-metadata.json", json.dumps({"properties": properties}))
    archive.writestr("META-INF/resources/doc.html", "<!doctype html>")
PY
}

contract_manifest="$contract_repo/tools/contracts.tsv"
cat > "$contract_manifest" <<'TSV'
# type<TAB>module<TAB>key-or-class<TAB>field-or-entry<TAB>expected-value
config	sample	sample.enabled
constant	sample	example.Contract	PATH	/doc
resource	sample	META-INF/resources/doc.html	/doc.html
TSV
build_contract_jar false
"$python_bin" "$repo_root/tools/verify-java-compatibility-contracts.py" \
  --repo-root "$contract_repo" --manifest "$contract_manifest"

build_contract_jar true
if "$python_bin" "$repo_root/tools/verify-java-compatibility-contracts.py" \
  --repo-root "$contract_repo" --manifest "$contract_manifest" \
  > "$fixture_root/contract-failure.stdout" 2> "$fixture_root/contract-failure.stderr"; then
  echo "Expected an unrecorded configuration key to fail the contract guard" >&2
  exit 1
fi
assert_contains "$fixture_root/contract-failure.stderr" "unrecorded configuration key: sample"

printf 'java compatibility tool tests passed\n'
