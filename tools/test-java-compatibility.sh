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
cp "$repo_root/tools/java-compatibility-summary.py" \
  "$repo_root/tools/verify-release-modules.sh" \
  "$report_repo/tools/"
printf '%s\n' \
  knife4j-api-breaking \
  knife4j-api-compatible \
  knife4j-resource-only \
  knife4j-dependencies > "$report_repo/tools/release-modules.txt"
cat > "$report_repo/knife4j/pom.xml" <<'XML'
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.baizhukui</groupId>
  <artifactId>fixture</artifactId>
  <version>1.0.0</version>
  <modules>
    <module>knife4j-api-breaking</module>
    <module>knife4j-api-compatible</module>
    <module>knife4j-resource-only</module>
    <module>knife4j-dependencies</module>
  </modules>
</project>
XML

for module in knife4j-api-breaking knife4j-api-compatible knife4j-resource-only; do
  mkdir -p "$report_repo/knife4j/$module/target"
  cat > "$report_repo/knife4j/$module/pom.xml" <<XML
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <artifactId>$module</artifactId>
</project>
XML
done
mkdir -p "$report_repo/knife4j/knife4j-dependencies"
cat > "$report_repo/knife4j/knife4j-dependencies/pom.xml" <<'XML'
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <artifactId>knife4j-dependencies</artifactId>
  <packaging>pom</packaging>
  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>com.baizhukui</groupId>
        <artifactId>knife4j-api-breaking</artifactId>
      </dependency>
      <dependency>
        <groupId>com.baizhukui</groupId>
        <artifactId>knife4j-api-compatible</artifactId>
      </dependency>
      <dependency>
        <groupId>com.baizhukui</groupId>
        <artifactId>knife4j-resource-only</artifactId>
      </dependency>
    </dependencies>
  </dependencyManagement>
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
for module in ("knife4j-api-breaking", "knife4j-api-compatible", "knife4j-resource-only"):
    with zipfile.ZipFile(baseline / f"{module}-1.0.0.jar", "w") as archive:
        archive.writestr("example/Api.class", b"baseline-" + module.encode())
    with zipfile.ZipFile(repo / "knife4j" / module / "target" / f"{module}-1.0.0.jar", "w") as archive:
        content = b"current-" + module.encode()
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
old_jar=""
new_jar=""
xml_file=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --old) old_jar=$2; shift 2 ;;
    --new) new_jar=$2; shift 2 ;;
    --xml-file) xml_file=$2; shift 2 ;;
    *) shift ;;
  esac
done
if [ -z "$old_jar" ] || [ -z "$new_jar" ] || [ "$old_jar" = "$new_jar" ]; then
  echo "mock japicmp requires distinct --old and --new paths" >&2
  exit 10
fi
case "$old_jar" in
  *-1.0.0-central.jar) ;;
  *) echo "mock japicmp received an unexpected baseline source: $old_jar" >&2; exit 11 ;;
esac
case "$new_jar" in
  */target/*-1.0.0.jar) ;;
  *) echo "mock japicmp received an unexpected current source: $new_jar" >&2; exit 12 ;;
esac
if cmp -s "$old_jar" "$new_jar"; then
  echo "mock japicmp received identical baseline and current data" >&2
  exit 13
fi
printf '%s\t%s\n' "$old_jar" "$new_jar" >> "$MOCK_JAVA_ARGUMENT_LOG"
case "$new_jar" in
  *knife4j-api-breaking*)
    change='<compatibilityChange binaryCompatible="false" sourceCompatible="false" type="METHOD_REMOVED"/>'
    status=REMOVED
    ;;
  *knife4j-api-compatible*)
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
mock_java_argument_log="$fixture_root/mock-java-arguments.tsv"
MOCK_CENTRAL_DIR="$baseline_dir" \
MOCK_JAVA_ARGUMENT_LOG="$mock_java_argument_log" \
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
"$python_bin" - "$report_output/summary.json" "$mock_java_argument_log" <<'PY'
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["reportOnly"] is True
assert payload["baselineVersion"] == "1.0.0"
assert payload["currentVersion"] == "1.0.0"
assert payload["totals"]["breaking"] == 1
assert payload["totals"]["compatible"] == 1
assert payload["totals"]["implementation_only"] == 1
assert payload["totals"]["pom"] == 1
comparisons = [line.split("\t") for line in open(sys.argv[2], encoding="utf-8").read().splitlines()]
assert len(comparisons) == 3
assert all(old != new for old, new in comparisons)
assert all(old.endswith("-1.0.0-central.jar") for old, _ in comparisons)
assert all("/target/" in new and new.endswith("-1.0.0.jar") for _, new in comparisons)
PY

failure_output="$fixture_root/failure-output"
if MOCK_JAVA_FAIL=true \
  MOCK_CENTRAL_DIR="$baseline_dir" \
  MOCK_JAVA_ARGUMENT_LOG="$mock_java_argument_log" \
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
  MOCK_JAVA_ARGUMENT_LOG="$mock_java_argument_log" \
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

complete_release_modules="$fixture_root/release-modules.complete"
cp "$report_repo/tools/release-modules.txt" "$complete_release_modules"
grep -v '^knife4j-api-compatible$' "$complete_release_modules" > "$report_repo/tools/release-modules.txt"
missing_module_output="$fixture_root/missing-module-output"
if MOCK_CENTRAL_DIR="$baseline_dir" \
  MOCK_JAVA_ARGUMENT_LOG="$mock_java_argument_log" \
  JAVA_COMPATIBILITY_REPO_ROOT="$report_repo" \
  JAVA_COMPATIBILITY_OUTPUT_DIR="$missing_module_output" \
  JAVA_COMPATIBILITY_BASELINE_FILE="$baseline_file" \
  JAVA_COMPATIBILITY_CENTRAL_BASE_URL="https://central.invalid" \
  JAVA_COMPATIBILITY_CURL_BIN="$mock_curl" \
  JAVA_COMPATIBILITY_JAVA_BIN="$mock_java" \
  JAVA_COMPATIBILITY_PYTHON_BIN="$python_bin" \
  JAVA_COMPATIBILITY_TOOL_JAR="$tool_jar" \
  JAVA_COMPATIBILITY_SKIP_CONTRACTS=true \
    "$repo_root/tools/java-compatibility-report.sh" \
    > "$fixture_root/missing-module.stdout" 2> "$fixture_root/missing-module.stderr"; then
  echo "Expected an incomplete release module list to fail the report" >&2
  exit 1
fi
cp "$complete_release_modules" "$report_repo/tools/release-modules.txt"
assert_contains "$fixture_root/missing-module.stdout" \
  "BOM artifact is missing from tools/release-modules.txt: knife4j-api-compatible"
assert_contains "$missing_module_output/state.txt" "failed (exit 1)"

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
  include_resource=$2
  "$python_bin" - "$contract_repo" "$fixture_root/contract-classes/example/Contract.class" \
    "$extra_key" "$include_resource" <<'PY'
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
    if sys.argv[4] == "true":
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
build_contract_jar false true
"$python_bin" "$repo_root/tools/verify-java-compatibility-contracts.py" \
  --repo-root "$contract_repo" --manifest "$contract_manifest"

bad_constant_manifest="$fixture_root/bad-constant-contracts.tsv"
"$python_bin" - "$contract_manifest" "$bad_constant_manifest" <<'PY'
import sys

source, destination = sys.argv[1:]
contents = open(source, encoding="utf-8").read()
contents = contents.replace(
    "constant\tsample\texample.Contract\tPATH\t/doc\n",
    "constant\tsample\texample.Contract\tPATH\t/changed\n",
)
open(destination, "w", encoding="utf-8").write(contents)
PY
if "$python_bin" "$repo_root/tools/verify-java-compatibility-contracts.py" \
  --repo-root "$contract_repo" --manifest "$bad_constant_manifest" \
  > "$fixture_root/constant-failure.stdout" 2> "$fixture_root/constant-failure.stderr"; then
  echo "Expected a changed public constant to fail the contract guard" >&2
  exit 1
fi
assert_contains "$fixture_root/constant-failure.stderr" \
  "constant drift: sample:example.Contract#PATH != /changed"

build_contract_jar false false
if "$python_bin" "$repo_root/tools/verify-java-compatibility-contracts.py" \
  --repo-root "$contract_repo" --manifest "$contract_manifest" \
  > "$fixture_root/resource-failure.stdout" 2> "$fixture_root/resource-failure.stderr"; then
  echo "Expected a missing public resource to fail the contract guard" >&2
  exit 1
fi
assert_contains "$fixture_root/resource-failure.stderr" \
  "public entry /doc.html is missing archive resource sample:META-INF/resources/doc.html"

build_contract_jar true true
if "$python_bin" "$repo_root/tools/verify-java-compatibility-contracts.py" \
  --repo-root "$contract_repo" --manifest "$contract_manifest" \
  > "$fixture_root/contract-failure.stdout" 2> "$fixture_root/contract-failure.stderr"; then
  echo "Expected an unrecorded configuration key to fail the contract guard" >&2
  exit 1
fi
assert_contains "$fixture_root/contract-failure.stderr" "unrecorded configuration key: sample"

printf 'java compatibility tool tests passed\n'
