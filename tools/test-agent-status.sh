#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
subject="$repo_root/tools/agent-status.sh"
fixture="$repo_root/tools/test-fixtures/agent-status/gh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

mkdir -p "$tmp_dir/bin"
ln -s "$fixture" "$tmp_dir/bin/gh"
export PATH="$tmp_dir/bin:$PATH"
export FAKE_GH_LOG="$tmp_dir/gh.log"
export GH_REPO="test/repo"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_contains() {
  case "$1" in
    *"$2"*) ;;
    *) fail "expected output to contain: $2" ;;
  esac
}

assert_not_contains() {
  case "$1" in
    *"$2"*) fail "expected output not to contain: $2" ;;
    *) ;;
  esac
}

assert_calls() {
  local prefix=$1
  local expected=$2
  local actual
  actual="$(awk -v prefix="$prefix" 'index($0, prefix) == 1 { count++ } END { print count + 0 }' "$FAKE_GH_LOG")"
  [ "$actual" = "$expected" ] || fail "expected $expected '$prefix' calls, got $actual"
}

reset_fake() {
  : > "$FAKE_GH_LOG"
  unset FAKE_REPO_FAIL FAKE_ISSUE_FAIL FAKE_PR_FAIL FAKE_PR
}

export FAKE_ISSUES=$'1\tReady task\tstatus:ready\tarea:java\n2\tWorking task\tstatus:in-progress\tarea:ui-react\n3\tBlocked task\tstatus:blocked\t'

reset_fake
output="$("$subject" all)"
assert_contains "$output" "#1"
assert_contains "$output" "Ready task"
assert_contains "$output" "Working task"
assert_contains "$output" "Blocked task"
assert_contains "$output" "status:review"
assert_calls "issue list" 1
assert_calls "repo view" 0

reset_fake
output="$("$subject" ready)"
assert_contains "$output" "Ready task"
assert_not_contains "$output" "Blocked task"
assert_calls "issue list" 1

reset_fake
export FAKE_PR=$'#42 OPEN Agent status PR https://example.test/pr/42\n  changes: success'
output="$("$subject" snapshot)"
assert_contains "$output" "git snapshot"
assert_contains "$output" "#42 OPEN Agent status PR"
assert_contains "$output" "Working task"
assert_contains "$output" "Ready task"
assert_calls "issue list" 1
assert_calls "pr list" 1

reset_fake
set +e
output="$("$subject" invalid 2>&1)"
status=$?
set -e
[ "$status" = 2 ] || fail "invalid mode should exit 2, got $status"
assert_contains "$output" "Usage:"
assert_calls "issue list" 0

reset_fake
export FAKE_ISSUE_FAIL=true
set +e
output="$("$subject" all 2>&1)"
status=$?
set -e
[ "$status" != 0 ] || fail "issue query failure should be non-zero"
assert_contains "$output" "fake issue failure"
assert_not_contains "$output" "(none)"

reset_fake
unset GH_REPO GITHUB_REPOSITORY
export FAKE_REPO_FAIL=true
set +e
output="$("$subject" all 2>&1)"
status=$?
set -e
[ "$status" != 0 ] || fail "repo resolution failure should be non-zero"
assert_contains "$output" "fake repo failure"
assert_calls "repo view" 1

printf 'agent status tests passed\n'
