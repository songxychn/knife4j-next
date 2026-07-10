#!/usr/bin/env bash
# agent-status.sh — 查看 GitHub Issues 驱动的任务看板
# 用法: ./tools/agent-status.sh [ready|in-progress|review|blocked|all|snapshot]
# 仓库：GH_REPO / GITHUB_REPOSITORY → gh repo view → 默认 songxychn/knife4j-next

set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI 'gh' is required." >&2
  exit 1
fi

if [ -n "${GH_REPO:-}" ]; then
  REPO="$GH_REPO"
elif [ -n "${GITHUB_REPOSITORY:-}" ]; then
  REPO="$GITHUB_REPOSITORY"
else
  REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"
fi
REPO="${REPO:-songxychn/knife4j-next}"
STATUS="${1:-all}"

# 颜色
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

status_color() {
  case "$1" in
    ready)        echo -e "$GREEN" ;;
    in-progress)  echo -e "$YELLOW" ;;
    review)       echo -e "$BLUE" ;;
    blocked)      echo -e "$RED" ;;
    *)            echo -e "$CYAN" ;;
  esac
}

print_status_group() {
  local st="$1"
  local color
  color=$(status_color "$st")
  echo -e "\n${color}━━━ status:${st} ━━━${NC}"

  local issues
  issues=$(gh issue list --repo "$REPO" --label "agent-task" --label "status:${st}" --state open --json number,title,labels --jq '.[] | "\(.number)|\(.title)|\([.labels[].name | select(startswith("area:"))] | join(","))"' 2>/dev/null || true)

  if [ -z "$issues" ]; then
    echo "  (none)"
    return
  fi

  while IFS='|' read -r num title area; do
    printf "  #%-4s %-8s %s\n" "$num" "[${area:-?}]" "$title"
  done <<< "$issues"
}

print_git_snapshot() {
  echo -e "${CYAN}━━━ git snapshot ━━━${NC}"
  echo "repo: $REPO"

  local branch
  branch=$(git branch --show-current 2>/dev/null || true)
  if [ -z "$branch" ]; then
    branch="(detached HEAD)"
  fi
  echo "branch: $branch"

  local head
  head=$(git rev-parse --short HEAD 2>/dev/null || true)
  echo "head: ${head:-unknown}"

  local status
  status=$(git status --short 2>/dev/null || true)
  if [ -z "$status" ]; then
    echo "worktree: clean"
  else
    echo "worktree:"
    echo "$status" | sed 's/^/  /'
  fi
}

print_pr_snapshot() {
  echo -e "\n${CYAN}━━━ github snapshot ━━━${NC}"

  local current_pr
  current_pr=$(gh pr view --repo "$REPO" --json number,title,state,url --jq '"#\(.number) \(.state) \(.title) \(.url)"' 2>/dev/null || true)
  if [ -n "$current_pr" ]; then
    echo "current PR: $current_pr"
    echo "checks:"
    gh pr checks --repo "$REPO" 2>/dev/null | sed 's/^/  /' || true
  else
    echo "current PR: (none for current branch)"
  fi
}

print_snapshot() {
  print_git_snapshot
  print_pr_snapshot
  print_status_group "in-progress"
  print_status_group "ready"
}

if [ "$STATUS" = "all" ]; then
  echo -e "${CYAN}📋 knife4j-next Agent Task Board (${REPO})${NC}"
  for st in ready in-progress review blocked; do
    print_status_group "$st"
  done
  echo ""
  echo "Quick commands:"
  echo "  ./tools/agent-status.sh snapshot"
  echo "  gh issue edit <N> --repo ${REPO} --remove-label status:ready --add-label status:in-progress --add-assignee @me"
  echo "  gh issue edit <N> --repo ${REPO} --remove-label status:in-progress --add-label status:review"
  echo "  gh issue comment <N> --repo ${REPO} --body 'progress update'"
  echo "  gh issue close <N> --repo ${REPO}"
elif [ "$STATUS" = "snapshot" ]; then
  print_snapshot
else
  print_status_group "$STATUS"
fi
