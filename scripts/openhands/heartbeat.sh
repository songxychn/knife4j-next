#!/usr/bin/env bash
# heartbeat.sh - OpenHands 任务队列心跳脚本
# 对标 OpenClaw heartbeat，定期检查 GitHub Issues 并（dry-run 模式）打印下一个待执行任务
#
# 用法:
#   heartbeat.sh [--dry-run] [--once]
#
# 退出码:
#   0 - 正常（队列空或成功打印下一任务）
#   1 - 脚本错误（gh 未登录、网络失败等）
#   2 - 工作区不干净（拒绝继续）
#
# Crontab 示例（每 2 小时唤醒一次）:
#   0 */2 * * * /path/to/scripts/openhands/heartbeat.sh >> /var/log/openhands/heartbeat.log 2>&1

set -euo pipefail

# ── 常量 ──────────────────────────────────────────────────────────────────────
REPO="songxychn/knife4j-next"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# ── 参数解析 ──────────────────────────────────────────────────────────────────
DRY_RUN=false
ONCE=false

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --once)    ONCE=true ;;
    --help|-h)
      sed -n '2,20p' "$0" | grep '^#' | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo "[ERROR] 未知参数: $arg" >&2
      exit 1
      ;;
  esac
done

# ── 工具函数 ──────────────────────────────────────────────────────────────────
log()  { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"; }
err()  { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [ERROR] $*" >&2; }
info() { log "[INFO] $*"; }
warn() { log "[WARN] $*"; }

# ── 前置检查 ──────────────────────────────────────────────────────────────────
check_dependencies() {
  if ! command -v gh &>/dev/null; then
    err "gh CLI 未安装或不在 PATH 中"
    exit 1
  fi

  if ! gh auth status &>/dev/null; then
    err "gh 未登录，请先运行 'gh auth login'"
    exit 1
  fi

  if ! command -v jq &>/dev/null; then
    err "jq 未安装，请先安装 jq"
    exit 1
  fi

  if [[ "$DRY_RUN" == "false" && -z "${OPENHANDS_PASS:-}" ]]; then
    err "非 dry-run 模式需要设置 OPENHANDS_PASS 环境变量"
    exit 1
  fi
}

check_workspace_clean() {
  cd "$REPO_ROOT"

  if ! git rev-parse --git-dir &>/dev/null; then
    err "当前目录不是 git 仓库: $REPO_ROOT"
    exit 1
  fi

  local dirty
  dirty="$(git status --porcelain 2>/dev/null)"
  if [[ -n "$dirty" ]]; then
    err "工作区不干净，拒绝继续执行任务："
    err "$dirty"
    exit 2
  fi

  info "工作区干净 ✓"
}

# ── 任务队列 ──────────────────────────────────────────────────────────────────
fetch_ready_issues() {
  gh issue list \
    --repo "$REPO" \
    --label "agent-task" \
    --label "status:ready" \
    --state open \
    --json number,title,labels \
    --limit 20 \
    2>/dev/null || {
      err "获取 GitHub Issues 失败（网络错误或权限不足）"
      exit 1
    }
}

# 优先选带 source:im 标签的 issue，否则取第一条
select_next_issue() {
  local issues_json="$1"

  # 优先 source:im
  local im_issue
  im_issue="$(echo "$issues_json" | jq -r '
    map(select(.labels[].name == "source:im")) | first |
    if . then "\(.number)\t\(.title)" else empty end
  ' 2>/dev/null)"

  if [[ -n "$im_issue" ]]; then
    echo "$im_issue"
    return
  fi

  # 否则取第一条
  echo "$issues_json" | jq -r 'first | "\(.number)\t\(.title)"' 2>/dev/null
}

# ── 主流程 ────────────────────────────────────────────────────────────────────
main() {
  info "=== OpenHands Heartbeat 启动 ==="
  info "模式: dry_run=${DRY_RUN}, once=${ONCE}"
  info "仓库: ${REPO}"
  info "工作区: ${REPO_ROOT}"

  check_dependencies
  check_workspace_clean

  info "正在拉取 status:ready 任务队列..."
  local issues_json
  issues_json="$(fetch_ready_issues)"

  local count
  count="$(echo "$issues_json" | jq 'length')"

  if [[ "$count" -eq 0 ]]; then
    info "队列为空，无待执行任务。退出。"
    exit 0
  fi

  info "发现 ${count} 个 ready 任务："
  echo "$issues_json" | jq -r '.[] | "  #\(.number) \(.title)"'

  local next_issue
  next_issue="$(select_next_issue "$issues_json")"

  if [[ -z "$next_issue" ]]; then
    warn "无法选出下一个任务，跳过。"
    exit 0
  fi

  local issue_number issue_title
  issue_number="$(echo "$next_issue" | cut -f1)"
  issue_title="$(echo "$next_issue" | cut -f2-)"

  info "选中任务: #${issue_number} ${issue_title}"

  if [[ "$DRY_RUN" == "true" ]]; then
    info "[DRY-RUN] 将执行以下操作（未实际调用 OpenHands）："
    info "  1. gh issue edit ${issue_number} --add-label status:in-progress"
    info "  2. 调用 OpenHands API，传入 issue #${issue_number} 的任务描述"
    info "  3. 等待 OpenHands 完成，获取 PR 链接"
    info "  4. gh issue edit ${issue_number} --remove-label status:in-progress --add-label status:review"
    info "[DRY-RUN] 完成，未做任何实际修改。"
  else
    info "调用 trigger-task.sh 处理 Issue #${issue_number}..."
    local trigger_script="${SCRIPT_DIR}/trigger-task.sh"
    if [[ ! -x "$trigger_script" ]]; then
      chmod +x "$trigger_script"
    fi
    OPENHANDS_PASS="${OPENHANDS_PASS:-}" \
      "$trigger_script" "$issue_number" || {
        local exit_code=$?
        warn "trigger-task.sh 退出码: ${exit_code}（已在 issue 上留评论）"
      }
  fi

  info "=== Heartbeat 完成 ==="
  exit 0
}

main "$@"
