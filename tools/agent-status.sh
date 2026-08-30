#!/usr/bin/env bash
# 用法: ./tools/agent-status.sh [ready|in-progress|review|blocked|all|snapshot]

set -euo pipefail

if [ "$#" -gt 1 ] || { [ "$#" -eq 1 ] && [ -z "$1" ]; }; then
  echo "Usage: $0 [ready|in-progress|review|blocked|all|snapshot]" >&2
  exit 2
fi

mode="${1:-all}"
case "$mode" in
  ready|in-progress|review|blocked|all|snapshot) ;;
  *)
    echo "Usage: $0 [ready|in-progress|review|blocked|all|snapshot]" >&2
    exit 2
    ;;
esac

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI 'gh' is required." >&2
  exit 1
fi

if [ -n "${GH_REPO:-}" ]; then
  repo="$GH_REPO"
elif [ -n "${GITHUB_REPOSITORY:-}" ]; then
  repo="$GITHUB_REPOSITORY"
else
  repo="$(gh repo view --json nameWithOwner --jq '.nameWithOwner')"
fi
[ -n "$repo" ] || { echo "Unable to resolve GitHub repository." >&2; exit 1; }

issues_tsv="$(
  gh issue list \
    --repo "$repo" \
    --label agent-task \
    --state open \
    --limit 1000 \
    --json number,title,labels \
    --jq '.[] | . as $issue | ([.labels[].name | select(startswith("area:"))] | join(",")) as $areas | .labels[].name | select(startswith("status:")) | "\($issue.number)\u001f\($issue.title)\u001f\(.)\u001f\($areas)"'
)"

print_status_group() {
  local status=$1
  local found=false
  local number title status_label area

  printf '\n=== status:%s ===\n' "$status"
  while IFS=$'\x1f' read -r number title status_label area; do
    [ -n "$number" ] || continue
    [ "$status_label" = "status:$status" ] || continue
    found=true
    printf '  #%-4s %-20s %s\n' "$number" "[${area:-?}]" "$title"
  done <<< "$issues_tsv"

  if [ "$found" = false ]; then
    echo "  (none)"
  fi
}

print_git_snapshot() {
  local branch head worktree
  branch="$(git branch --show-current)"
  head="$(git rev-parse --short HEAD)"
  worktree="$(git status --short)"

  echo "=== git snapshot ==="
  echo "repo: $repo"
  echo "branch: ${branch:-(detached HEAD)}"
  echo "head: $head"
  if [ -z "$worktree" ]; then
    echo "worktree: clean"
  else
    echo "worktree:"
    printf '%s\n' "$worktree" | sed 's/^/  /'
  fi
}

print_pr_snapshot() {
  local branch head current_pr pr_jq
  branch="$(git branch --show-current)"
  head="$(git rev-parse HEAD)"

  echo
  echo "=== github snapshot ==="
  if [ -z "$branch" ]; then
    echo "current PR: (none for detached HEAD)"
    return
  fi

  pr_jq='map(select(.headRefOid == "'"$head"'")) | .[0] | if . == null then empty else "#\(.number) \(.state) \(.title) \(.url)\n" + ((.statusCheckRollup // []) | map(if .__typename == "CheckRun" then "  \(.name): " + (if .status != "COMPLETED" then (.status | ascii_downcase) else ((.conclusion // "UNKNOWN") | ascii_downcase) end) else "  \(.context): \((.state // "UNKNOWN") | ascii_downcase)" end) | join("\n")) end'
  current_pr="$(
    gh pr list \
      --repo "$repo" \
      --head "$branch" \
      --state all \
      --limit 100 \
      --json number,title,state,url,headRefOid,statusCheckRollup \
      --jq "$pr_jq"
  )"

  if [ -z "$current_pr" ]; then
    echo "current PR: (none for current head)"
  else
    echo "current PR:"
    printf '%s\n' "$current_pr" | sed 's/^/  /'
  fi
}

case "$mode" in
  all)
    echo "knife4j-next Agent Task Board ($repo)"
    for status in ready in-progress review blocked; do
      print_status_group "$status"
    done
    ;;
  snapshot)
    print_git_snapshot
    print_pr_snapshot
    print_status_group in-progress
    print_status_group ready
    ;;
  *)
    print_status_group "$mode"
    ;;
esac
