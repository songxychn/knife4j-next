#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
central_verifier="$repo_root/tools/verify-maven-central.sh"
context_verifier="$repo_root/tools/verify-release-context.sh"
github_verifier="$repo_root/tools/verify-github-release.sh"
mock_curl="$repo_root/tools/test-fixtures/mock-maven-central-curl.sh"
mock_gh="$repo_root/tools/test-fixtures/mock-gh-release.sh"
workflow="$repo_root/.github/workflows/release.yml"
demo_workflow="$repo_root/.github/workflows/deploy-demo.yml"
pom_file="$repo_root/knife4j/pom.xml"
tmp_root="$(mktemp -d)"
trap 'rm -rf "$tmp_root"' EXIT

fail() {
  echo "release tooling test failed: $*" >&2
  exit 1
}

assert_contains() {
  local file="$1"
  local expected="$2"
  if ! grep -Fq -- "$expected" "$file"; then
    echo "Expected to find in $file: $expected" >&2
    sed -n '1,220p' "$file" >&2
    fail "missing expected output"
  fi
}

assert_not_contains() {
  local file="$1"
  local unexpected="$2"
  if grep -Fq -- "$unexpected" "$file"; then
    echo "Did not expect to find in $file: $unexpected" >&2
    sed -n '1,220p' "$file" >&2
    fail "unexpected output"
  fi
}

fixture_root="$tmp_root/maven-fixture"
mkdir -p \
  "$fixture_root/tools" \
  "$fixture_root/knife4j/api" \
  "$fixture_root/knife4j/bom" \
  "$fixture_root/knife4j/knife4j-test-ui" \
  "$fixture_root/knife4j/knife4j-other-ui"

printf '%s\n' \
  '<project>' \
  '  <groupId>com.example</groupId>' \
  '  <artifactId>parent</artifactId>' \
  '  <version>1.2.3</version>' \
  '  <packaging>pom</packaging>' \
  '</project>' > "$fixture_root/knife4j/pom.xml"
printf '%s\n' '<project>' '<artifactId>api</artifactId>' '</project>' > "$fixture_root/knife4j/api/pom.xml"
printf '%s\n' '<project>' '<artifactId>bom</artifactId>' '<packaging>pom</packaging>' '</project>' > "$fixture_root/knife4j/bom/pom.xml"
printf '%s\n' '<project>' '<artifactId>knife4j-test-ui</artifactId>' '</project>' > "$fixture_root/knife4j/knife4j-test-ui/pom.xml"
printf '%s\n' '<project>' '<artifactId>knife4j-other-ui</artifactId>' '</project>' > "$fixture_root/knife4j/knife4j-other-ui/pom.xml"
printf '%s\n' api bom knife4j-test-ui knife4j-other-ui > "$fixture_root/tools/release-modules.txt"
[ ! -e "$fixture_root/tools/verify-maven-central.sh" ] || \
  fail "legacy release fixture must not contain the current Central verifier"

jar_payload="$tmp_root/jar-payload"
valid_jar="$tmp_root/valid.jar"
mkdir -p "$jar_payload/META-INF/resources"
printf '<!doctype html>\n' > "$jar_payload/META-INF/resources/doc.html"
jar cf "$valid_jar" -C "$jar_payload" .

# Record requested waits without making the offline suite wait for real time.
mkdir -p "$tmp_root/mock-bin"
printf '%s\n' '#!/usr/bin/env bash' \
  'printf "%s\n" "$1" >> "${MOCK_SLEEP_LOG:?}"' > "$tmp_root/mock-bin/sleep"
chmod +x "$tmp_root/mock-bin/sleep"

verifier_status=0
verifier_log=""
verifier_requests=""
verifier_sleeps=""

run_verifier() {
  local name="$1"
  local plan_content="$2"
  local attempts="$3"
  local invalid_jar_pattern="${4:-}"
  local retry_interval="${5:-60}"
  local network_retry_interval="${6-}"
  local case_root="$tmp_root/$name"
  local plan_file="$case_root/plan"

  mkdir -p "$case_root/state"
  printf '%s\n' "$plan_content" > "$plan_file"
  verifier_log="$case_root/output.log"
  verifier_requests="$case_root/state/requests.log"
  verifier_sleeps="$case_root/sleeps.log"
  : > "$verifier_sleeps"

  set +e
  env \
    PATH="$tmp_root/mock-bin:$PATH" \
    MOCK_SLEEP_LOG="$verifier_sleeps" \
    VERIFY_MAVEN_REPO_ROOT="$fixture_root" \
    MAVEN_CENTRAL_BASE_URL="https://central.example/maven2" \
    MAVEN_CENTRAL_MAX_ATTEMPTS="$attempts" \
    MAVEN_CENTRAL_RETRY_INTERVAL_SECONDS="$retry_interval" \
    MAVEN_CENTRAL_NETWORK_RETRY_INTERVAL_SECONDS="$network_retry_interval" \
    MAVEN_CENTRAL_CONNECT_TIMEOUT_SECONDS=1 \
    MAVEN_CENTRAL_REQUEST_TIMEOUT_SECONDS=1 \
    MAVEN_CENTRAL_CURL_BIN="$mock_curl" \
    MOCK_CURL_STATE_DIR="$case_root/state" \
    MOCK_CURL_PLAN="$plan_file" \
    MOCK_CURL_VALID_JAR="$valid_jar" \
    MOCK_CURL_INVALID_JAR_PATTERN="$invalid_jar_pattern" \
    "$central_verifier" 1.2.3 > "$verifier_log" 2>&1
  verifier_status=$?
  set -e
}

assert_request_count() {
  local filename="$1"
  local kind="$2"
  local expected="$3"
  local actual
  actual="$(awk -F '\t' -v filename="$filename" -v kind="$kind" '
    { count = split($2, parts, "/") }
    parts[count] == filename && $3 == kind { matches++ }
    END { print matches + 0 }
  ' "$verifier_requests")"
  [ "$actual" -eq "$expected" ] || \
    fail "$filename $kind requests: expected $expected, got $actual"
}

assert_sleeps() {
  local expected="$1"
  local actual
  actual="$(paste -sd, "$verifier_sleeps")"
  [ "$actual" = "$expected" ] || fail "retry waits: expected '$expected', got '$actual'"
}

run_verifier all-available "" 1
[ "$verifier_status" -eq 0 ] || fail "all available case should pass"
assert_contains "$verifier_log" "Maven Central artifacts OK"
assert_contains "$verifier_requests" "https://central.example/maven2/com/example/bom/1.2.3/bom-1.2.3.pom"
assert_not_contains "$verifier_requests" 'com\/example'
assert_not_contains "$verifier_requests" "bom-1.2.3.jar"
assert_contains "$verifier_log" "24 exact files, 2 UI JARs readable"
assert_sleeps ""

run_verifier delayed $'api-1.2.3.jar|1|404|22|not found\n' 2
[ "$verifier_status" -eq 0 ] || fail "404 then available case should pass"
assert_contains "$verifier_log" "attempt 1/2"
assert_contains "$verifier_log" "attempt 2/2"

run_verifier permanent-missing $'api-1.2.3.jar|99|404|22|not found\n' 2
[ "$verifier_status" -ne 0 ] || fail "permanently missing artifact should fail"
assert_contains "$verifier_log" "timed out after 2 attempt(s)"
assert_contains "$verifier_log" "Unavailable modules/artifacts: api"
assert_contains "$verifier_log" "HTTP 404"

run_verifier missing-companions $'api-1.2.3.jar.asc|99|404|22|signature missing\nbom-1.2.3.pom.sha1|99|404|22|checksum missing\n' 1
[ "$verifier_status" -ne 0 ] || fail "missing signature/checksum should fail"
assert_contains "$verifier_log" "api-1.2.3.jar.asc"
assert_contains "$verifier_log" "bom-1.2.3.pom.sha1"
assert_contains "$verifier_log" "Unavailable modules/artifacts: api,bom"

run_verifier request-timeout $'knife4j-test-ui-1.2.3.jar.sha1|99|000|28|operation timed out\n' 1
[ "$verifier_status" -ne 0 ] || fail "request timeout should fail"
assert_contains "$verifier_log" "curl 28"
assert_contains "$verifier_log" "operation timed out"

run_verifier unreadable-ui "" 1 "knife4j-test-ui-1.2.3.jar"
[ "$verifier_status" -ne 0 ] || fail "unreadable UI JAR should fail"
assert_contains "$verifier_log" "downloaded UI JAR is unreadable"

run_verifier transient-network $'api-1.2.3.jar|1|000|35|Recv failure: Connection reset by peer\n' 2
[ "$verifier_status" -eq 0 ] || fail "transient TLS reset should recover"
assert_sleeps "2"
assert_contains "$verifier_log" "curl 35"
assert_contains "$verifier_log" "Recv failure: Connection reset by peer"
assert_contains "$verifier_log" "network/transfer failures"
assert_not_contains "$verifier_log" "Central not ready"
assert_request_count api-1.2.3.jar probe 2
assert_request_count parent-1.2.3.pom probe 1
assert_request_count api-1.2.3.jar.asc probe 1
[ "$(wc -l < "$verifier_requests")" -eq 27 ] || \
  fail "one transient failure should need 24 probes + 1 retry + 2 UI downloads"

# If an already successful URL is checked again, it fails from its second call.
run_verifier rotating-network $'api-1.2.3.jar|1|000|35|reset\nbom-1.2.3.pom|99|000|35|reset|probe|2\n' 3
[ "$verifier_status" -eq 0 ] || fail "successful URLs must survive rotating network failures"
assert_sleeps "2"
assert_request_count bom-1.2.3.pom probe 1
assert_request_count api-1.2.3.jar probe 2

run_verifier persistent-network $'api-1.2.3.jar|99|000|35|reset\n' 3
[ "$verifier_status" -ne 0 ] || fail "persistent TLS failure must remain bounded and fail"
assert_sleeps "2,2"
assert_request_count api-1.2.3.jar probe 3
assert_request_count parent-1.2.3.pom probe 1
assert_request_count knife4j-test-ui-1.2.3.jar download 0
assert_contains "$verifier_log" "timed out after 3 attempt(s)"

run_verifier early-diagnostics $'api-1.2.3.jar|1|404|22|not found\n' 2
[ "$verifier_status" -eq 0 ] || fail "delayed publication should still recover"
assert_sleeps "60"
assert_contains "$verifier_log" "HTTP 404"
assert_request_count api-1.2.3.jar probe 2
assert_request_count api-1.2.3.jar.asc probe 1
diagnostic_line="$(awk '/HTTP 404/ { print NR; exit }' "$verifier_log")"
retry_line="$(awk '/retrying in/ { print NR; exit }' "$verifier_log")"
[ "$diagnostic_line" -lt "$retry_line" ] || fail "failure details must precede the first wait"

run_verifier mixed-errors $'api-1.2.3.jar|1|000|35|reset\nbom-1.2.3.pom|1|404|22|not found\n' 2
[ "$verifier_status" -eq 0 ] || fail "mixed network and publication failures should recover"
assert_sleeps "60"
assert_contains "$verifier_log" "curl 35"
assert_contains "$verifier_log" "HTTP 404"
assert_request_count parent-1.2.3.pom probe 1

run_verifier http-error $'api-1.2.3.jar|1|503|22|unavailable\n' 2
[ "$verifier_status" -eq 0 ] || fail "HTTP response failures should retain the normal interval"
assert_sleeps "60"
assert_contains "$verifier_log" "HTTP 503"

for code in 5 6 7 16 52 55 92; do
  run_verifier "network-code-$code" "$(printf 'api-1.2.3.jar|1|000|%s|transport failure\n' "$code")" 2
  [ "$verifier_status" -eq 0 ] || fail "curl $code should recover through network retries"
  assert_sleeps "2"
  assert_contains "$verifier_log" "curl $code"
done

for code in 23 47 60; do
  run_verifier "non-network-code-$code" "$(printf 'api-1.2.3.jar|1|000|%s|non-transport failure\n' "$code")" 2
  [ "$verifier_status" -eq 0 ] || fail "curl $code should preserve the normal retry path"
  assert_sleeps "60"
  assert_not_contains "$verifier_log" "network/transfer failures"
done

run_verifier custom-network-interval $'api-1.2.3.jar|1|000|28|timeout\n' 2 "" 60 1
[ "$verifier_status" -eq 0 ] || fail "custom network retry interval should recover"
assert_sleeps "1"

run_verifier zero-network-interval $'api-1.2.3.jar|1|000|35|reset\n' 2 "" 0 0
[ "$verifier_status" -eq 0 ] || fail "zero retry interval should be supported"
assert_sleeps ""

run_verifier legacy-zero-interval $'api-1.2.3.jar|1|000|35|reset\n' 2 "" 0
[ "$verifier_status" -eq 0 ] || fail "existing callers setting only the normal interval to zero must not wait"
assert_sleeps ""

run_verifier tighter-normal-interval $'api-1.2.3.jar|1|000|35|reset\n' 2 "" 1 5
[ "$verifier_status" -eq 0 ] || fail "network retry must not exceed the normal interval"
assert_sleeps "1"

run_verifier ui-download-network $'knife4j-other-ui-1.2.3.jar|1|000|56|receive failed|download\n' 2
[ "$verifier_status" -eq 0 ] || fail "UI download network failure should recover"
assert_sleeps "2"
assert_request_count knife4j-test-ui-1.2.3.jar download 1
assert_request_count knife4j-other-ui-1.2.3.jar download 2
assert_request_count knife4j-other-ui-1.2.3.jar probe 1
assert_contains "$verifier_log" "(readability)"
assert_contains "$verifier_log" "curl 56"

run_verifier ui-download-partial $'knife4j-other-ui-1.2.3.jar|1|200|18|partial transfer|download\n' 2
[ "$verifier_status" -eq 0 ] || fail "partial 200 UI transfer must be retried, not accepted"
assert_sleeps "2"
assert_request_count knife4j-other-ui-1.2.3.jar download 2
assert_contains "$verifier_log" "HTTP 200 (curl 18)"

run_verifier ui-download-missing $'knife4j-other-ui-1.2.3.jar|99|404|22|not found|download\n' 2
[ "$verifier_status" -ne 0 ] || fail "successful Range GET cannot replace a full UI download"
assert_sleeps "60"
assert_request_count knife4j-test-ui-1.2.3.jar download 1
assert_request_count knife4j-other-ui-1.2.3.jar download 2
assert_request_count knife4j-other-ui-1.2.3.jar probe 1

run_verifier cached-ui-not-unreadable "" 2 "knife4j-other-ui-1.2.3.jar"
[ "$verifier_status" -ne 0 ] || fail "unreadable UI archives must never enter the success cache"
assert_sleeps "60"
assert_request_count knife4j-test-ui-1.2.3.jar download 1
assert_request_count knife4j-other-ui-1.2.3.jar download 2
assert_contains "$verifier_log" "downloaded UI JAR is unreadable"

run_verifier new-process-no-cache $'parent-1.2.3.pom.asc|99|404|22|signature missing\n' 1
[ "$verifier_status" -ne 0 ] || fail "each invocation must independently verify all exact files"
assert_request_count parent-1.2.3.pom.asc probe 1
assert_request_count api-1.2.3.jar probe 1
assert_contains "$verifier_log" "parent-1.2.3.pom.asc"

run_verifier invalid-network-interval "" 1 "" 60 invalid
[ "$verifier_status" -ne 0 ] || fail "invalid retry interval must fail before requesting artifacts"
assert_contains "$verifier_log" "MAVEN_CENTRAL_NETWORK_RETRY_INTERVAL_SECONDS must be a non-negative integer"
[ ! -e "$verifier_requests" ] || fail "invalid configuration must not send requests"

make_context_repo() {
  local name="$1"
  local pom_version="$2"
  local note_version="$3"
  local tag_kind="$4"
  local context_root="$tmp_root/context-$name"

  mkdir -p "$context_root/knife4j" "$context_root/docs/release-notes"
  git -C "$context_root" init -q
  git -C "$context_root" config user.name "Release Tool Test"
  git -C "$context_root" config user.email "release-tool-test@example.invalid"
  printf '%s\n' \
    '<project>' \
    '  <groupId>com.example</groupId>' \
    '  <artifactId>parent</artifactId>' \
    "  <version>$pom_version</version>" \
    '</project>' > "$context_root/knife4j/pom.xml"
  printf '%s\n' \
    '# Release notes' \
    '' \
    "### $note_version" \
    '' \
    '- test release note' \
    '' \
    '---' > "$context_root/docs/release-notes/index.md"
  git -C "$context_root" add knife4j/pom.xml docs/release-notes/index.md
  git -C "$context_root" commit -q -m "test fixture"
  if [ "$tag_kind" = "annotated" ]; then
    git -C "$context_root" tag -a v1.2.3 -m "test release"
  else
    git -C "$context_root" tag v1.2.3
  fi
  printf '%s\n' "$context_root"
}

run_context() {
  local name="$1"
  local context_root="$2"
  local tag="$3"
  local output_file="$tmp_root/$name-notes.md"
  local log_file="$tmp_root/$name-context.log"

  set +e
  env VERIFY_RELEASE_REPO_ROOT="$context_root" \
    "$context_verifier" "$tag" "$output_file" > "$log_file" 2>&1
  context_status=$?
  set -e
  context_log="$log_file"
  context_output="$output_file"
}

context_root="$(make_context_repo success 1.2.3 1.2.3 annotated)"
[ ! -e "$context_root/tools/verify-release-context.sh" ] || \
  fail "legacy release fixture must not contain the current context verifier"
run_context context-success "$context_root" v1.2.3
[ "$context_status" -eq 0 ] || fail "valid release context should pass"
assert_contains "$context_output" "## 1.2.3"

run_context context-missing-tag "$context_root" v9.9.9
[ "$context_status" -ne 0 ] || fail "missing tag should fail"
assert_contains "$context_log" "tag does not exist"

context_mismatch="$(make_context_repo mismatch 2.0.0 1.2.3 annotated)"
run_context context-mismatch "$context_mismatch" v1.2.3
[ "$context_status" -ne 0 ] || fail "tag/POM version mismatch should fail"
assert_contains "$context_log" "does not match POM version"

context_missing_note="$(make_context_repo missing-note 1.2.3 9.9.9 annotated)"
run_context context-missing-note "$context_missing_note" v1.2.3
[ "$context_status" -ne 0 ] || fail "missing release note should fail"
assert_contains "$context_log" "Release note section not found"

context_regex_like_note="$(make_context_repo regex-like-note 1.2.3 1x2x3 annotated)"
run_context context-regex-like-note "$context_regex_like_note" v1.2.3
[ "$context_status" -ne 0 ] || fail "regex-like release note version should fail"
assert_contains "$context_log" "Release note section not found"

context_lightweight="$(make_context_repo lightweight 1.2.3 1.2.3 lightweight)"
run_context context-lightweight "$context_lightweight" v1.2.3
[ "$context_status" -ne 0 ] || fail "lightweight tag should fail"
assert_contains "$context_log" "tag must be annotated"

context_wrong_head="$(make_context_repo wrong-head 1.2.3 1.2.3 annotated)"
printf 'after tag\n' > "$context_wrong_head/after-tag.txt"
git -C "$context_wrong_head" add after-tag.txt
git -C "$context_wrong_head" commit -q -m "move head"
run_context context-wrong-head "$context_wrong_head" v1.2.3
[ "$context_status" -ne 0 ] || fail "tag/HEAD mismatch should fail"
assert_contains "$context_log" "does not match v1.2.3"

module_root="$tmp_root/release-modules-root"
mkdir -p \
  "$module_root/tools" \
  "$module_root/knife4j/knife4j-api" \
  "$module_root/knife4j/knife4j-dependencies"
printf '%s\n' \
  '<project>' \
  '  <modules><module>knife4j-api</module></modules>' \
  '</project>' > "$module_root/knife4j/pom.xml"
printf '%s\n' '<project><artifactId>knife4j-api</artifactId></project>' > "$module_root/knife4j/knife4j-api/pom.xml"
printf '%s\n' \
  '<project>' \
  '  <dependencyManagement>' \
  '    <dependencies>' \
  '      <dependency>' \
  '        <groupId>com.baizhukui</groupId>' \
  '        <artifactId>knife4j-api</artifactId>' \
  '      </dependency>' \
  '    </dependencies>' \
  '  </dependencyManagement>' \
  '</project>' > "$module_root/knife4j/knife4j-dependencies/pom.xml"
printf '%s\n' knife4j-api > "$module_root/tools/release-modules.txt"
if ! env VERIFY_RELEASE_REPO_ROOT="$module_root" \
  "$repo_root/tools/verify-release-modules.sh" > "$tmp_root/release-modules.log" 2>&1; then
  sed -n '1,220p' "$tmp_root/release-modules.log" >&2
  fail "release module verifier should read the overridden repository root"
fi
assert_contains "$tmp_root/release-modules.log" "Release module list OK (1 modules)."

expected_github_body="$tmp_root/expected-github-body.md"
different_github_body="$tmp_root/different-github-body.md"
printf '%s\n' 'expected release body' > "$expected_github_body"
printf '%s\n' 'different release body' > "$different_github_body"

github_status=0
github_log=""

run_github_verifier() {
  local name="$1"
  local state="$2"
  local actual_tag="$3"
  local latest_tag="$4"
  local require_latest="$5"
  local body_file="$6"

  github_log="$tmp_root/$name-github.log"
  set +e
  env \
    GITHUB_RELEASE_GH_BIN="$mock_gh" \
    MOCK_GH_RELEASE_STATE="$state" \
    MOCK_GH_RELEASE_TAG="$actual_tag" \
    MOCK_GH_LATEST_TAG="$latest_tag" \
    MOCK_GH_RELEASE_BODY_FILE="$body_file" \
    VERIFY_GITHUB_RELEASE_REQUIRE_LATEST="$require_latest" \
    "$github_verifier" v1.2.3 "$expected_github_body" example/repo \
    > "$github_log" 2>&1
  github_status=$?
  set -e
}

run_github_verifier github-published published v1.2.3 v1.2.3 false "$expected_github_body"
[ "$github_status" -eq 0 ] || fail "published GitHub Release should pass"
assert_contains "$github_log" "GitHub Release OK: example/repo@v1.2.3"

run_github_verifier github-draft draft v1.2.3 v1.2.3 false "$expected_github_body"
[ "$github_status" -ne 0 ] || fail "draft GitHub Release should fail"
assert_contains "$github_log" "is still a draft"

run_github_verifier github-prerelease prerelease v1.2.3 v1.2.3 false "$expected_github_body"
[ "$github_status" -ne 0 ] || fail "prerelease GitHub Release should fail"
assert_contains "$github_log" "is a prerelease"

run_github_verifier github-wrong-tag published v9.9.9 v9.9.9 false "$expected_github_body"
[ "$github_status" -ne 0 ] || fail "mismatched GitHub Release tag should fail"
assert_contains "$github_log" "tag mismatch"

run_github_verifier github-old-release published v1.2.3 v2.0.0 true "$expected_github_body"
[ "$github_status" -ne 0 ] || fail "non-latest GitHub Release should fail the deployment gate"
assert_contains "$github_log" "current latest GitHub Release is v2.0.0"

run_github_verifier github-latest published v1.2.3 v1.2.3 true "$expected_github_body"
[ "$github_status" -eq 0 ] || fail "current latest GitHub Release should pass the deployment gate"

run_github_verifier github-body-mismatch published v1.2.3 v1.2.3 false "$different_github_body"
[ "$github_status" -ne 0 ] || fail "mismatched GitHub Release body should fail"
assert_contains "$github_log" "body differs"

assert_contains "$workflow" "mode:"
assert_contains "$workflow" "finalize-only"
assert_contains "$workflow" "tag:"
assert_contains "$workflow" "fetch-depth: 0"
assert_contains "$workflow" "path: release-source"
assert_contains "$workflow" "VERIFY_RELEASE_REPO_ROOT="
assert_contains "$workflow" "VERIFY_MAVEN_REPO_ROOT="
assert_contains "$workflow" "tools/verify-release-context.sh"
assert_contains "$workflow" "tools/verify-maven-central.sh"
assert_not_contains "$workflow" '\$RELEASE_ROOT/tools/verify-release-modules.sh'
assert_contains "$workflow" "  deploy-demo:"
assert_contains "$workflow" "    needs: publish"
assert_contains "$workflow" "    if: \${{ needs.publish.result == 'success' }}"
assert_contains "$workflow" "    uses: ./.github/workflows/deploy-demo.yml"
assert_contains "$workflow" "      tag: \${{ github.event_name == 'workflow_dispatch' && inputs.tag || github.ref_name }}"
assert_not_contains "$workflow" "    secrets: inherit"
assert_contains "$workflow" "              --draft=false \\"
assert_contains "$workflow" "              --prerelease=false"

if grep -Eq '^  push:' "$demo_workflow"; then
  fail "demo workflow must not trigger independently from a pushed tag"
fi
assert_contains "$demo_workflow" "  workflow_call:"
assert_contains "$demo_workflow" "  workflow_dispatch:"
assert_contains "$demo_workflow" "  RELEASE_TAG: \${{ inputs.tag }}"
assert_contains "$demo_workflow" "      RELEASE_ROOT: \${{ github.workspace }}/release-source"
assert_contains "$demo_workflow" "      - name: Checkout current deployment tooling"
assert_contains "$demo_workflow" "          ref: \${{ github.sha }}"
assert_contains "$demo_workflow" "      - name: Checkout exact release tag source"
assert_contains "$demo_workflow" "          ref: \${{ env.RELEASE_TAG }}"
assert_contains "$demo_workflow" "          path: release-source"
assert_contains "$demo_workflow" "          fetch-depth: 0"
assert_contains "$demo_workflow" "  verify-release:"
assert_contains "$demo_workflow" "    timeout-minutes: 45"
assert_contains "$demo_workflow" "          VERIFY_GITHUB_RELEASE_REQUIRE_LATEST: true"
assert_contains "$demo_workflow" "          VERIFY_RELEASE_REPO_ROOT=\"\$RELEASE_ROOT\" \\"
assert_contains "$demo_workflow" "          VERIFY_MAVEN_REPO_ROOT=\"\$RELEASE_ROOT\" \\"
assert_contains "$demo_workflow" "          tools/verify-release-context.sh"
assert_contains "$demo_workflow" "          tools/verify-maven-central.sh"
assert_contains "$demo_workflow" "          tools/verify-github-release.sh"
assert_contains "$demo_workflow" "    needs: verify-release"
assert_contains "$demo_workflow" '            type=semver,pattern={{version}},value=${{ inputs.tag }}'
assert_contains "$demo_workflow" "          password: \${{ github.token }}"
assert_not_contains "$demo_workflow" "secrets.GITHUB_TOKEN"

required_tag_inputs="$(grep -c -F -- '        required: true' "$demo_workflow")"
[ "$required_tag_inputs" -eq 2 ] || fail "demo workflow must require a tag for both workflow_call and workflow_dispatch"

demo_verify_block="$tmp_root/demo-verify-block.txt"
demo_build_block="$tmp_root/demo-build-block.txt"
awk '/^  verify-release:/ { keep=1 } /^  build-and-push:/ { keep=0 } keep { print }' \
  "$demo_workflow" > "$demo_verify_block"
awk '/^  build-and-push:/ { keep=1 } keep { print }' \
  "$demo_workflow" > "$demo_build_block"
assert_contains "$demo_verify_block" "          ref: \${{ github.sha }}"
assert_contains "$demo_verify_block" "          path: release-source"
assert_contains "$demo_verify_block" "          VERIFY_RELEASE_REPO_ROOT=\"\$RELEASE_ROOT\" \\"
assert_contains "$demo_verify_block" "          VERIFY_MAVEN_REPO_ROOT=\"\$RELEASE_ROOT\" \\"
assert_contains "$demo_build_block" "          ref: \${{ env.RELEASE_TAG }}"
assert_not_contains "$demo_build_block" "          ref: \${{ github.sha }}"

demo_context_line="$(awk 'index($0, "tools/verify-release-context.sh") { print NR; exit }' "$demo_workflow")"
demo_central_line="$(awk 'index($0, "tools/verify-maven-central.sh") { print NR; exit }' "$demo_workflow")"
demo_github_line="$(awk 'index($0, "tools/verify-github-release.sh") { print NR; exit }' "$demo_workflow")"
demo_build_line="$(awk '/^  build-and-push:/ { print NR; exit }' "$demo_workflow")"
if [ -z "$demo_context_line" ] || [ -z "$demo_central_line" ] || \
  [ -z "$demo_github_line" ] || [ -z "$demo_build_line" ] || \
  [ "$demo_context_line" -ge "$demo_central_line" ] || \
  [ "$demo_central_line" -ge "$demo_github_line" ] || \
  [ "$demo_github_line" -ge "$demo_build_line" ]; then
  fail "demo must verify tag, Central and published GitHub Release before building images"
fi

context_line="$(awk 'index($0, "tools/verify-release-context.sh") { print NR; exit }' "$workflow")"
modules_line="$(awk 'index($0, "tools/verify-release-modules.sh") { print NR; exit }' "$workflow")"
if [ -z "$context_line" ] || [ -z "$modules_line" ] || [ "$context_line" -ge "$modules_line" ]; then
  fail "current tooling must verify the release tag before checking its module data"
fi

publish_block="$tmp_root/publish-block.txt"
grep -A3 -F -- "- name: Publish to Maven Central" "$workflow" > "$publish_block"
assert_contains "$publish_block" 'if: ${{ github.event_name == '\''push'\'' }}'
deploy_count="$(grep -c -F -- 'mvn -B -ntp -Prelease deploy' "$workflow")"
[ "$deploy_count" -eq 1 ] || fail "release workflow must contain exactly one Maven deploy command"

central_line="$(awk 'index($0, "tools/verify-maven-central.sh") { print NR; exit }' "$workflow")"
release_line="$(awk '/- name: Create GitHub Release/ { print NR; exit }' "$workflow")"
if [ -z "$central_line" ] || [ -z "$release_line" ] || [ "$central_line" -ge "$release_line" ]; then
  fail "public Maven Central verification must run before GitHub Release creation"
fi

wait_max="$(awk -F'[<>]' '/<waitMaxTime>/ { gsub(/[[:space:]]/, "", $3); print $3; exit }' "$pom_file")"
poll_interval="$(awk -F'[<>]' '/<waitPollingInterval>/ { gsub(/[[:space:]]/, "", $3); print $3; exit }' "$pom_file")"
job_timeout="$(awk '/timeout-minutes:/ { print $2; exit }' "$workflow")"
[ -n "$wait_max" ] || fail "waitMaxTime must be configured explicitly"
[ -n "$poll_interval" ] || fail "waitPollingInterval must be configured explicitly"
[ -n "$job_timeout" ] || fail "release job timeout must be configured explicitly"
if [ "$((job_timeout * 60))" -le "$wait_max" ]; then
  fail "release job timeout must exceed the Central plugin waitMaxTime"
fi

printf 'release tooling tests passed\n'
