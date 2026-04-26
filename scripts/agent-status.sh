#!/usr/bin/env bash
# agent-status.sh — 查看 GitHub Issues 驱动的任务看板
# 用法: ./scripts/agent-status.sh [ready|in-progress|review|blocked|all]

set -euo pipefail

REPO="songxychn/knife4j-next"
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

if [ "$STATUS" = "all" ]; then
  echo -e "${CYAN}📋 knife4j-next Agent Task Board${NC}"
  for st in ready in-progress review blocked; do
    print_status_group "$st"
  done
  echo ""
  echo "Quick commands:"
  echo "  gh issue edit <N> --add-label status:in-progress    # pick up"
  echo "  gh issue edit <N> --add-label status:review          # done coding"
  echo "  gh issue comment <N> --body 'progress update'        # log progress"
  echo "  gh issue close <N>                                   # merged"
else
  print_status_group "$STATUS"
fi

