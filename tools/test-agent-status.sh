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
export GITHUB_HEAD_REF="fixture-branch"

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

assert_occurrences() {
  local text=$1
  local needle=$2
  local expected=$3
  local actual
  actual="$(printf '%s\n' "$text" | awk -v needle="$needle" 'index($0, needle) { count++ } END { print count + 0 }')"
  [ "$actual" = "$expected" ] || fail "expected $expected '$needle' occurrences, got $actual"
}

assert_log_contains() {
  assert_contains "$(cat "$FAKE_GH_LOG")" "$1"
}

reset_fake() {
  : > "$FAKE_GH_LOG"
  unset FAKE_REPO_FAIL FAKE_ISSUE_FAIL FAKE_PR_FAIL FAKE_PR FAKE_EXPECT_PR_HEAD
}

assert_invalid() {
  local output status
  reset_fake
  set +e
  output="$("$subject" "$@" 2>&1)"
  status=$?
  set -e
  [ "$status" = 2 ] || fail "invalid arguments should exit 2, got $status"
  assert_contains "$output" "Usage:"
  assert_calls "repo view" 0
  assert_calls "issue list" 0
}

export FAKE_ISSUES=$'1\x1fReady task\x1fstatus:ready\x1farea:java\n2\x1fWorking task\x1fstatus:in-progress\x1farea:ui-react\n3\x1fBlocked task\x1fstatus:blocked\x1f\n4\x1fDual status\x1fstatus:ready\x1farea:java\n4\x1fDual status\x1fstatus:blocked\x1farea:java\n5\x1fPath C:\\tmp\x1fstatus:review\x1farea:docs'

reset_fake
output="$("$subject" all)"
assert_contains "$output" "#1"
assert_contains "$output" "Ready task"
assert_contains "$output" "Working task"
assert_contains "$output" "Blocked task"
assert_occurrences "$output" "Dual status" 2
assert_contains "$output" 'Path C:\tmp'
assert_contains "$output" "status:review"
assert_calls "issue list" 1
assert_calls "repo view" 0
assert_log_contains "--label agent-task"
assert_log_contains "--state open"

reset_fake
output="$("$subject" ready)"
assert_contains "$output" "Ready task"
assert_contains "$output" "Dual status"
assert_not_contains "$output" "Blocked task"
assert_calls "issue list" 1

reset_fake
export FAKE_PR=$'#42 OPEN Agent status PR https://example.test/pr/42\n  changes: success'
export FAKE_EXPECT_PR_HEAD="$(git rev-parse HEAD)"
output="$("$subject" snapshot)"
assert_contains "$output" "git snapshot"
assert_contains "$output" "#42 OPEN Agent status PR"
assert_contains "$output" "Working task"
assert_contains "$output" "Ready task"
assert_calls "issue list" 1
assert_calls "pr list" 1
assert_log_contains "--head fixture-branch"
assert_log_contains "headRefOid"
assert_log_contains "$(git rev-parse HEAD)"

detached_repo="$tmp_dir/detached-repo"
git -C "$tmp_dir" init -q -b base detached-repo
git -C "$detached_repo" -c user.name=Agent -c user.email=agent@example.test \
  commit -q --allow-empty -m base
git -C "$detached_repo" switch -q -c fixture-branch
git -C "$detached_repo" -c user.name=Agent -c user.email=agent@example.test \
  commit -q --allow-empty -m head
pr_head="$(git -C "$detached_repo" rev-parse HEAD)"
git -C "$detached_repo" switch -q base
git -C "$detached_repo" -c user.name=Agent -c user.email=agent@example.test \
  commit -q --allow-empty -m base-advance
git -C "$detached_repo" -c user.name=Agent -c user.email=agent@example.test \
  merge -q --no-ff fixture-branch -m synthetic-pr-merge
merge_head="$(git -C "$detached_repo" rev-parse HEAD)"
git -C "$detached_repo" switch -q --detach "$merge_head"

reset_fake
export FAKE_PR=$'#42 OPEN Detached PR https://example.test/pr/42\n  changes: success'
export FAKE_EXPECT_PR_HEAD="$pr_head"
output="$({
  cd "$detached_repo"
  GITHUB_HEAD_REF=fixture-branch \
    GITHUB_REF=refs/pull/42/merge \
    GITHUB_SHA="$merge_head" \
    "$subject" snapshot
})"
assert_contains "$output" "branch: (detached HEAD)"
assert_contains "$output" "#42 OPEN Detached PR"
assert_log_contains "--head fixture-branch"
assert_log_contains "$pr_head"
assert_not_contains "$(cat "$FAKE_GH_LOG")" "$merge_head"

reset_fake
output="$("$subject" snapshot)"
assert_contains "$output" "current PR: (none for current head)"
assert_calls "pr list" 1

reset_fake
export FAKE_PR_FAIL=true
set +e
output="$("$subject" snapshot 2>&1)"
status=$?
set -e
[ "$status" != 0 ] || fail "PR query failure should be non-zero"
assert_contains "$output" "fake pr failure"
assert_not_contains "$output" "none for current head"

assert_invalid invalid
assert_invalid ""
assert_invalid ready unexpected

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
