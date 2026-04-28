#!/usr/bin/env bash
# trigger-task.sh - 通过 OpenHands API 执行 worker + reviewer 流程
#
# 用法:
#   trigger-task.sh <issue_number>
#
# 环境变量:
#   OPENHANDS_URL   - OpenHands 服务地址（默认 http://localhost:3000）
#   OPENHANDS_USER  - Basic Auth 用户名（默认 admin）
#   OPENHANDS_PASS  - Basic Auth 密码（必填）
#   GH_TOKEN        - GitHub Token（用于 OpenHands 操作仓库）
#
# 退出码:
#   0 - PR 已开，reviewer approve
#   1 - 脚本错误
#   2 - reviewer block/revise，需人工介入

set -euo pipefail

REPO="songxychn/knife4j-next"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OH_URL="${OPENHANDS_URL:-http://localhost:3000}"
OH_USER="${OPENHANDS_USER:-admin}"
OH_PASS="${OPENHANDS_PASS:?需要设置 OPENHANDS_PASS 环境变量}"
POLL_INTERVAL=15
POLL_TIMEOUT=1800  # 30 分钟超时

log()  { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"; }
err()  { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [ERROR] $*" >&2; }
info() { log "[INFO] $*"; }
warn() { log "[WARN] $*"; }

# ── 参数 ──────────────────────────────────────────────────────────────────────
ISSUE_NUMBER="${1:?用法: trigger-task.sh <issue_number>}"

# ── OpenHands API 工具函数 ────────────────────────────────────────────────────

oh_post() {
  local path="$1"
  local body="$2"
  curl -s -X POST "${OH_URL}${path}" \
    -u "${OH_USER}:${OH_PASS}" \
    -H "Content-Type: application/json" \
    -d "$body"
}

oh_get() {
  local path="$1"
  curl -s "${OH_URL}${path}" \
    -u "${OH_USER}:${OH_PASS}"
}

# 创建对话，返回 conversation_id
create_conversation() {
  local message="$1"
  local resp
  resp="$(oh_post "/api/conversations" "$(jq -n --arg m "$message" '{"initial_message":$m}')")"
  echo "$resp" | jq -r '.conversation_id // empty'
}

# 轮询对话直到完成，返回最后一条 assistant 消息
wait_conversation() {
  local conv_id="$1"
  local elapsed=0

  while [[ $elapsed -lt $POLL_TIMEOUT ]]; do
    sleep $POLL_INTERVAL
    elapsed=$((elapsed + POLL_INTERVAL))

    local status_resp
    status_resp="$(oh_get "/api/conversations/${conv_id}")"
    local status
    status="$(echo "$status_resp" | jq -r '.status // empty')"

    info "  对话 ${conv_id} 状态: ${status} (${elapsed}s)"

    if [[ "$status" == "STOPPED" || "$status" == "ERROR" ]]; then
      # 获取最后一条消息
      local msgs
      msgs="$(oh_get "/api/conversations/${conv_id}/messages")"
      echo "$msgs" | jq -r '[.messages[] | select(.role=="assistant")] | last | .content // ""'
      return 0
    fi
  done

  err "对话 ${conv_id} 超时（${POLL_TIMEOUT}s）"
  return 1
}

# ── 获取 Issue 信息 ───────────────────────────────────────────────────────────
fetch_issue() {
  gh issue view "$ISSUE_NUMBER" --repo "$REPO" --json number,title,body,labels \
    2>/dev/null || {
      err "获取 Issue #${ISSUE_NUMBER} 失败"
      exit 1
    }
}

# ── Worker 阶段 ───────────────────────────────────────────────────────────────
run_worker() {
  local issue_json="$1"
  local issue_title issue_body
  issue_title="$(echo "$issue_json" | jq -r '.title')"
  issue_body="$(echo "$issue_json" | jq -r '.body // ""')"

  info "=== Worker 阶段：处理 Issue #${ISSUE_NUMBER} ==="

  local worker_prompt
  worker_prompt="$(cat "${REPO_ROOT}/.agent/prompts/worker.md")

Task id: issue-${ISSUE_NUMBER}
Task title: ${issue_title}
Issue URL: https://github.com/${REPO}/issues/${ISSUE_NUMBER}
Issue body:
${issue_body}

Assigned scope: 根据 issue 内容确定
Allowed files or modules: 根据 issue 内容确定
Disallowed files or modules: master 分支直接 push、.agent/TASKS.md、.agent/PROGRESS.md
Validation command: 根据改动类型选择（见 repo.md）
Done condition: feature branch 已推送，PR 已开，handoff 已返回

仓库路径: ${REPO_ROOT}
目标仓库: https://github.com/${REPO}
请 clone 仓库，创建 feature branch，实现修复，推送并开 PR。
PR 描述只用 ## 作分节标题，内容用普通文字或 - 列表，不用其他 markdown 标题级别。"

  local conv_id
  conv_id="$(create_conversation "$worker_prompt")"

  if [[ -z "$conv_id" ]]; then
    err "创建 worker 对话失败"
    exit 1
  fi

  info "Worker 对话 ID: ${conv_id}"
  local result
  result="$(wait_conversation "$conv_id")"
  echo "$result"
}

# ── Reviewer 阶段 ─────────────────────────────────────────────────────────────
run_reviewer() {
  local pr_number="$1"
  local worker_handoff="$2"

  info "=== Reviewer 阶段：审查 PR #${pr_number} ==="

  local pr_diff
  pr_diff="$(gh pr diff "$pr_number" --repo "$REPO" 2>/dev/null | head -500)"

  local reviewer_prompt
  reviewer_prompt="$(cat "${REPO_ROOT}/.agent/prompts/reviewer.md")

Task id: issue-${ISSUE_NUMBER}
Branch or diff to review: PR #${pr_number}
Issue URL: https://github.com/${REPO}/issues/${ISSUE_NUMBER}
Worker handoff:
${worker_handoff}

Diff (first 500 lines):
${pr_diff}

Validation already run: 见 worker handoff
Known risks: 见 worker handoff
Reviewer constraints: 只返回 findings，不修改代码"

  local conv_id
  conv_id="$(create_conversation "$reviewer_prompt")"

  if [[ -z "$conv_id" ]]; then
    err "创建 reviewer 对话失败"
    exit 1
  fi

  info "Reviewer 对话 ID: ${conv_id}"
  wait_conversation "$conv_id"
}

# ── 主流程 ────────────────────────────────────────────────────────────────────
main() {
  info "=== trigger-task.sh 启动：Issue #${ISSUE_NUMBER} ==="

  # 拾取任务
  gh issue edit "$ISSUE_NUMBER" --repo "$REPO" --add-label "status:in-progress"
  info "Issue #${ISSUE_NUMBER} 已标记 status:in-progress"

  # 获取 issue 信息
  local issue_json
  issue_json="$(fetch_issue)"

  # Worker
  local worker_result
  worker_result="$(run_worker "$issue_json")"
  info "Worker 完成，handoff:"
  echo "$worker_result"

  # 从 worker 结果里提取 PR 号
  local pr_number
  pr_number="$(gh pr list --repo "$REPO" --head "fix/issue-${ISSUE_NUMBER}" \
    --json number -q '.[0].number' 2>/dev/null || \
    gh pr list --repo "$REPO" --head "agent/TASK-${ISSUE_NUMBER}" \
    --json number -q '.[0].number' 2>/dev/null || echo "")"

  if [[ -z "$pr_number" ]]; then
    # 尝试从 worker 输出里提取 PR 号
    pr_number="$(echo "$worker_result" | grep -oP 'PR #\K[0-9]+' | head -1 || echo "")"
  fi

  if [[ -z "$pr_number" ]]; then
    warn "无法找到 PR，跳过 reviewer 阶段，需人工检查"
    gh issue edit "$ISSUE_NUMBER" --repo "$REPO" \
      --remove-label "status:in-progress" --add-label "status:blocked"
    gh issue comment "$ISSUE_NUMBER" --repo "$REPO" \
      --body "Worker 完成但未找到 PR，需人工检查。\n\nWorker handoff:\n\`\`\`\n${worker_result}\n\`\`\`"
    exit 2
  fi

  info "找到 PR #${pr_number}"

  # Reviewer
  local reviewer_result
  reviewer_result="$(run_reviewer "$pr_number" "$worker_result")"
  info "Reviewer 完成，findings:"
  echo "$reviewer_result"

  # 判断 reviewer 结论
  local recommendation
  recommendation="$(echo "$reviewer_result" | grep -i 'recommendation' | tail -1 | grep -oiE 'approve|revise|block' || echo "unknown")"
  info "Reviewer 结论: ${recommendation}"

  if [[ "$recommendation" == "approve" ]]; then
    # 等 CI 全绿
    info "等待 CI 检查..."
    gh pr checks "$pr_number" --repo "$REPO" --watch 2>/dev/null || true

    local ci_status
    ci_status="$(gh pr checks "$pr_number" --repo "$REPO" --json state -q '.[].state' 2>/dev/null | sort -u)"

    if echo "$ci_status" | grep -qiE 'failure|error'; then
      warn "CI 未全绿，标记 blocked"
      gh issue edit "$ISSUE_NUMBER" --repo "$REPO" \
        --remove-label "status:in-progress" --add-label "status:blocked"
      gh issue comment "$ISSUE_NUMBER" --repo "$REPO" \
        --body "PR #${pr_number} CI 失败，需人工修复。"
      exit 2
    fi

    gh issue edit "$ISSUE_NUMBER" --repo "$REPO" \
      --remove-label "status:in-progress" --add-label "status:review"
    gh issue comment "$ISSUE_NUMBER" --repo "$REPO" \
      --body "PR #${pr_number} 已开，reviewer approve，CI 全绿，等待合并。\n\nReviewer findings:\n\`\`\`\n${reviewer_result}\n\`\`\`"
    info "Issue #${ISSUE_NUMBER} 已标记 status:review"
    exit 0

  else
    warn "Reviewer 结论: ${recommendation}，标记 blocked"
    gh issue edit "$ISSUE_NUMBER" --repo "$REPO" \
      --remove-label "status:in-progress" --add-label "status:blocked"
    gh issue comment "$ISSUE_NUMBER" --repo "$REPO" \
      --body "PR #${pr_number} reviewer ${recommendation}，需人工介入。\n\nReviewer findings:\n\`\`\`\n${reviewer_result}\n\`\`\`"
    exit 2
  fi
}

main "$@"
