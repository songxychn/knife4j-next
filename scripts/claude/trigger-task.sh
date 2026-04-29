#!/usr/bin/env bash
# trigger-task.sh - 通过 Claude Code CLI 执行 worker + reviewer 两阶段流程
#
# 用法:
#   trigger-task.sh <issue_number>
#
# 环境变量:
#   REPO_ROOT   - 仓库根目录（默认自动推断）
#   GH_TOKEN    - GitHub Token（可选，已在 claude-worker 环境配置）
#
# 退出码:
#   0 - PR 已开，reviewer approve
#   1 - 脚本错误
#   2 - reviewer block/revise，需人工介入

set -euo pipefail

REPO="songxychn/knife4j-next"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CLAUDE_USER="claude-worker"
CLAUDE_CMD="claude --permission-mode bypassPermissions --print"

log()  { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"; }
err()  { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [ERROR] $*" >&2; }
info() { log "[INFO] $*"; }
warn() { log "[WARN] $*"; }

# ── 参数 ──────────────────────────────────────────────────────────────────────
ISSUE_NUMBER="${1:?用法: trigger-task.sh <issue_number>}"

# ── Claude Code 调用 ──────────────────────────────────────────────────────────

run_claude() {
  local prompt="$1"
  su -s /bin/bash "${CLAUDE_USER}" -c \
    "cd '${REPO_ROOT}' && ${CLAUDE_CMD} $(printf '%q' "$prompt")"
}

# ── 获取 issue 信息 ───────────────────────────────────────────────────────────

info "获取 issue #${ISSUE_NUMBER} 信息..."
ISSUE_JSON=$(gh issue view "${ISSUE_NUMBER}" --repo "${REPO}" \
  --json title,body,labels,assignees 2>&1) || {
  err "无法获取 issue #${ISSUE_NUMBER}"
  exit 1
}
ISSUE_TITLE=$(echo "${ISSUE_JSON}" | jq -r '.title')
info "Issue: ${ISSUE_TITLE}"

# ── 标记 in-progress ──────────────────────────────────────────────────────────

gh issue edit "${ISSUE_NUMBER}" --repo "${REPO}" \
  --remove-label "status:ready" \
  --add-label "status:in-progress" 2>/dev/null || true

# ── 读取 prompt 模板 ──────────────────────────────────────────────────────────

WORKER_TEMPLATE=$(cat "${REPO_ROOT}/.agent/prompts/worker.md")
REVIEWER_TEMPLATE=$(cat "${REPO_ROOT}/.agent/prompts/reviewer.md")

# ── Phase 1: Worker ───────────────────────────────────────────────────────────

info "=== Phase 1: Worker ==="

WORKER_PROMPT="${WORKER_TEMPLATE}

Task id: issue-${ISSUE_NUMBER}
Task title: ${ISSUE_TITLE}
Issue URL: https://github.com/${REPO}/issues/${ISSUE_NUMBER}
Assigned scope: 见 issue 描述
Disallowed files: .agent/TASKS.md, .agent/PROGRESS.md
Validation command: 见 issue 描述或 .agent/RUNBOOK.md
Done condition: 代码改动完成，验证通过，返回标准 handoff

Issue body:
$(echo "${ISSUE_JSON}" | jq -r '.body // ""')
"

info "启动 worker..."
WORKER_OUTPUT=$(run_claude "${WORKER_PROMPT}") || {
  err "Worker 执行失败"
  gh issue comment "${ISSUE_NUMBER}" --repo "${REPO}" \
    --body "❌ Worker 执行失败，需人工介入。" 2>/dev/null || true
  exit 1
}

info "Worker 完成，输出长度: ${#WORKER_OUTPUT}"
echo "${WORKER_OUTPUT}" | tail -50

# 从 worker 输出提取分支名（如果有）
BRANCH=$(echo "${WORKER_OUTPUT}" | grep -oP 'feat/issue-\d+[^\s"]*' | head -1 || true)
if [[ -z "$BRANCH" ]]; then
  BRANCH="feat/issue-${ISSUE_NUMBER}"
fi
info "推断分支: ${BRANCH}"

# ── Phase 2: Reviewer ─────────────────────────────────────────────────────────

info "=== Phase 2: Reviewer ==="

# 获取 diff
DIFF=$(cd "${REPO_ROOT}" && git diff "master...origin/${BRANCH}" 2>/dev/null | head -500 || \
       git diff "master...${BRANCH}" 2>/dev/null | head -500 || echo "(diff unavailable)")

REVIEWER_PROMPT="${REVIEWER_TEMPLATE}

Task id: issue-${ISSUE_NUMBER}
Branch or diff to review: ${BRANCH}
Issue URL: https://github.com/${REPO}/issues/${ISSUE_NUMBER}
Claimed behavior change: 见 worker handoff summary
Validation already run: 见 worker handoff validation
Known risks: 见 worker handoff risks
Reviewer constraints: 只返回 findings，不修改代码

Worker handoff:
${WORKER_OUTPUT}

Diff (first 500 lines):
${DIFF}
"

info "启动 reviewer..."
REVIEWER_OUTPUT=$(run_claude "${REVIEWER_PROMPT}") || {
  err "Reviewer 执行失败"
  exit 1
}

info "Reviewer 完成"
echo "${REVIEWER_OUTPUT}" | tail -30

# ── 解析 reviewer 结论 ────────────────────────────────────────────────────────

RECOMMENDATION=$(echo "${REVIEWER_OUTPUT}" | grep -iP 'recommendation[:\s]+\K(approve|revise|block)' | head -1 || \
                 echo "${REVIEWER_OUTPUT}" | grep -iP '^- (approve|revise|block)$' | head -1 | tr -d '- ' || \
                 echo "unknown")
RECOMMENDATION=$(echo "${RECOMMENDATION}" | tr '[:upper:]' '[:lower:]' | tr -d ' ')

info "Reviewer recommendation: ${RECOMMENDATION}"

# ── 根据结论决策 ──────────────────────────────────────────────────────────────

case "${RECOMMENDATION}" in
  approve)
    info "Reviewer approve，准备开 PR..."

    # 开 PR
    PR_URL=$(cd "${REPO_ROOT}" && gh pr create \
      --repo "${REPO}" \
      --head "${BRANCH}" \
      --base master \
      --title "${ISSUE_TITLE}, closes #${ISSUE_NUMBER}" \
      --body "Closes #${ISSUE_NUMBER}

## Worker Handoff

\`\`\`
${WORKER_OUTPUT}
\`\`\`

## Reviewer Findings

\`\`\`
${REVIEWER_OUTPUT}
\`\`\`" 2>&1) || {
      err "开 PR 失败: ${PR_URL}"
      exit 1
    }

    PR_NUMBER=$(echo "${PR_URL}" | grep -oP '\d+$')
    info "PR #${PR_NUMBER} 已开: ${PR_URL}"

    # 通知
    openclaw message send \
      --account knife4j-next-bot \
      --channel telegram \
      --target 6358501334 \
      --message "🔪 [Issue #${ISSUE_NUMBER}] PR #${PR_NUMBER} 已创建：${PR_URL}" 2>/dev/null || true

    # 等 CI
    info "等待 CI..."
    cd "${REPO_ROOT}" && gh pr checks "${PR_NUMBER}" --repo "${REPO}" --watch || {
      warn "CI 有失败，需人工检查"
      gh issue comment "${ISSUE_NUMBER}" --repo "${REPO}" \
        --body "⚠️ PR #${PR_NUMBER} CI 失败，需人工检查。" 2>/dev/null || true
      exit 1
    }

    # CI 全绿
    gh issue edit "${ISSUE_NUMBER}" --repo "${REPO}" \
      --remove-label "status:in-progress" \
      --add-label "status:review" 2>/dev/null || true

    gh issue comment "${ISSUE_NUMBER}" --repo "${REPO}" \
      --body "✅ PR #${PR_NUMBER} CI 全绿，等待 review 合并。" 2>/dev/null || true

    info "完成，PR #${PR_NUMBER} 等待合并"
    exit 0
    ;;

  revise|block)
    warn "Reviewer ${RECOMMENDATION}，需人工介入"
    gh issue comment "${ISSUE_NUMBER}" --repo "${REPO}" \
      --body "🔍 Reviewer recommendation: **${RECOMMENDATION}**

\`\`\`
${REVIEWER_OUTPUT}
\`\`\`" 2>/dev/null || true

    gh issue edit "${ISSUE_NUMBER}" --repo "${REPO}" \
      --remove-label "status:in-progress" \
      --add-label "status:blocked" 2>/dev/null || true

    exit 2
    ;;

  *)
    warn "无法解析 reviewer recommendation（${RECOMMENDATION}），需人工检查"
    gh issue comment "${ISSUE_NUMBER}" --repo "${REPO}" \
      --body "⚠️ 无法解析 reviewer recommendation，需人工检查。

\`\`\`
${REVIEWER_OUTPUT}
\`\`\`" 2>/dev/null || true
    exit 1
    ;;
esac
