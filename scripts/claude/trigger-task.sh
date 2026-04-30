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
#   2 - reviewer block，需人工介入

set -euo pipefail

REPO="songxychn/knife4j-next"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CLAUDE_USER="claude-worker"
CLAUDE_CMD="claude --permission-mode bypassPermissions --print"
MAX_REVISE_ROUNDS=3

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

# ── run_worker: 执行 worker，可选传入 reviewer findings ──────────────────────
# 用法: run_worker [reviewer_findings]
# 输出: worker handoff（stdout）

run_worker() {
  local findings="${1:-}"
  local revise_section=""

  if [[ -n "$findings" ]]; then
    revise_section="
## Reviewer Findings（需修改后重新提交）

上一轮 reviewer 审查发现以下问题，请逐条修复后重新提交 handoff：

\`\`\`
${findings}
\`\`\`

修复要求：
- 针对每条 finding 说明你的处理方式
- 修改完成后重新运行验证命令确认通过
- 返回更新后的 handoff
"
  fi

  local prompt="${WORKER_TEMPLATE}

Task id: issue-${ISSUE_NUMBER}
Task title: ${ISSUE_TITLE}
Issue URL: https://github.com/${REPO}/issues/${ISSUE_NUMBER}
Assigned scope: 见 issue 描述
Disallowed files: .agent/TASKS.md, .agent/PROGRESS.md
Validation command: 见 issue 描述或 .agent/RUNBOOK.md
Done condition: 代码改动完成，验证通过，返回标准 handoff
${revise_section}
Issue body:
$(echo "${ISSUE_JSON}" | jq -r '.body // ""')
"

  run_claude "$prompt"
}

# ── run_reviewer: 执行 reviewer ───────────────────────────────────────────────
# 用法: run_reviewer <worker_output> <branch>
# 输出: reviewer findings（stdout）

run_reviewer() {
  local worker_output="$1"
  local branch="$2"

  local diff
  diff=$(cd "${REPO_ROOT}" && git diff "master...origin/${branch}" 2>/dev/null | head -500 || \
         git diff "master...${branch}" 2>/dev/null | head -500 || echo "(diff unavailable)")

  local prompt="${REVIEWER_TEMPLATE}

Task id: issue-${ISSUE_NUMBER}
Branch or diff to review: ${branch}
Issue URL: https://github.com/${REPO}/issues/${ISSUE_NUMBER}
Claimed behavior change: 见 worker handoff summary
Validation already run: 见 worker handoff validation
Known risks: 见 worker handoff risks
Reviewer constraints: 只返回 findings，不修改代码

Worker handoff:
${worker_output}

Diff (first 500 lines):
${diff}
"

  run_claude "$prompt"
}

# ── parse_recommendation ──────────────────────────────────────────────────────

parse_recommendation() {
  local output="$1"
  local rec
  # Pattern 1: "recommendation: approve" on same line
  rec=$(echo "${output}" | grep -iP 'recommendation[:\s]+\K(approve|revise|block)' | head -1 || true)
  if [[ -z "$rec" ]]; then
    # Pattern 2: YAML list style — "recommendation:" then "- approve" on next line
    rec=$(echo "${output}" | grep -iA1 '^recommendation:' | grep -oiP '(approve|revise|block)' | head -1 || true)
  fi
  if [[ -z "$rec" ]]; then
    # Pattern 3: standalone bullet "- approve" / "* approve"
    rec=$(echo "${output}" | grep -iP '^[-*]\s*(approve|revise|block)\s*$' | head -1 | grep -oiP 'approve|revise|block' || true)
  fi
  if [[ -z "$rec" ]]; then
    # Pattern 4: any line containing only the keyword (e.g. bold markdown **approve**)
    rec=$(echo "${output}" | grep -oiP '\b(approve|revise|block)\b' | tail -1 || true)
  fi
  echo "${rec}" | tr '[:upper:]' '[:lower:]' | tr -d ' '
}

# ── 主循环：worker → reviewer，最多 MAX_REVISE_ROUNDS 轮 ─────────────────────

WORKER_OUTPUT=""
REVIEWER_OUTPUT=""
RECOMMENDATION=""
BRANCH=""
ROUND=0
REVIEWER_FINDINGS=""

while [[ $ROUND -lt $MAX_REVISE_ROUNDS ]]; do
  ROUND=$(( ROUND + 1 ))
  info "=== Round ${ROUND}/${MAX_REVISE_ROUNDS} ==="

  # Phase 1: Worker
  info "--- Phase 1: Worker ---"
  WORKER_OUTPUT=$(run_worker "${REVIEWER_FINDINGS}") || {
    err "Worker 执行失败（round ${ROUND}）"
    gh issue comment "${ISSUE_NUMBER}" --repo "${REPO}" \
      --body "❌ Worker 执行失败（round ${ROUND}），需人工介入。" 2>/dev/null || true
    exit 1
  }
  info "Worker 完成，输出长度: ${#WORKER_OUTPUT}"
  echo "${WORKER_OUTPUT}" | tail -30

  # 提取分支名
  BRANCH=$(echo "${WORKER_OUTPUT}" | grep -oP '(feat|fix|chore|agent)/issue-\d+[^\s"]*' | head -1 || true)
  if [[ -z "$BRANCH" ]]; then
    BRANCH="feat/issue-${ISSUE_NUMBER}"
  fi
  info "推断分支: ${BRANCH}"

  # Phase 2: Reviewer
  info "--- Phase 2: Reviewer ---"
  REVIEWER_OUTPUT=$(run_reviewer "${WORKER_OUTPUT}" "${BRANCH}") || {
    err "Reviewer 执行失败（round ${ROUND}）"
    exit 1
  }
  info "Reviewer 完成"
  echo "${REVIEWER_OUTPUT}" | tail -20

  RECOMMENDATION=$(parse_recommendation "${REVIEWER_OUTPUT}")
  info "Reviewer recommendation: ${RECOMMENDATION}"

  case "${RECOMMENDATION}" in
    approve)
      info "Reviewer approve，跳出循环"
      break
      ;;
    revise)
      if [[ $ROUND -lt $MAX_REVISE_ROUNDS ]]; then
        warn "Reviewer revise（round ${ROUND}），将 findings 反馈给 worker 重新修改..."
        REVIEWER_FINDINGS="${REVIEWER_OUTPUT}"
        gh issue comment "${ISSUE_NUMBER}" --repo "${REPO}" \
          --body "🔄 Round ${ROUND}: Reviewer 要求修改，worker 重新处理中...

<details><summary>Reviewer findings</summary>

\`\`\`
${REVIEWER_OUTPUT}
\`\`\`
</details>" 2>/dev/null || true
      else
        warn "已达最大轮次（${MAX_REVISE_ROUNDS}），reviewer 仍要求修改，转人工介入"
        RECOMMENDATION="block"
      fi
      ;;
    block)
      warn "Reviewer block，转人工介入"
      break
      ;;
    *)
      warn "无法解析 reviewer recommendation（${RECOMMENDATION}），转人工介入"
      RECOMMENDATION="block"
      break
      ;;
  esac
done

# ── 根据最终结论决策 ──────────────────────────────────────────────────────────

case "${RECOMMENDATION}" in
  approve)
    info "准备开 PR..."

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

    openclaw message send \
      --account knife4j-next-bot \
      --channel telegram \
      --target 6358501334 \
      --message "🔪 [Issue #${ISSUE_NUMBER}] PR #${PR_NUMBER} 已创建：${PR_URL}" 2>/dev/null || true

    info "等待 CI..."
    cd "${REPO_ROOT}" && gh pr checks "${PR_NUMBER}" --repo "${REPO}" --watch || {
      warn "CI 有失败，需人工检查"
      gh issue comment "${ISSUE_NUMBER}" --repo "${REPO}" \
        --body "⚠️ PR #${PR_NUMBER} CI 失败，需人工检查。" 2>/dev/null || true
      exit 1
    }

    gh issue edit "${ISSUE_NUMBER}" --repo "${REPO}" \
      --remove-label "status:in-progress" \
      --add-label "status:review" 2>/dev/null || true

    gh issue comment "${ISSUE_NUMBER}" --repo "${REPO}" \
      --body "✅ PR #${PR_NUMBER} CI 全绿，等待 review 合并。" 2>/dev/null || true

    info "完成，PR #${PR_NUMBER} 等待合并"
    exit 0
    ;;

  *)
    # revise（超轮次）或 block 或 unknown
    warn "最终结论: ${RECOMMENDATION}，需人工介入"

    gh issue comment "${ISSUE_NUMBER}" --repo "${REPO}" \
      --body "🔍 Reviewer recommendation: **${RECOMMENDATION}**（经过 ${ROUND} 轮）

<details><summary>最后一轮 Reviewer findings</summary>

\`\`\`
${REVIEWER_OUTPUT}
\`\`\`
</details>" 2>/dev/null || true

    gh issue edit "${ISSUE_NUMBER}" --repo "${REPO}" \
      --remove-label "status:in-progress" \
      --add-label "status:blocked" 2>/dev/null || true

    openclaw message send \
      --account knife4j-next-bot \
      --channel telegram \
      --target 6358501334 \
      --message "🚫 [Issue #${ISSUE_NUMBER}] Reviewer ${RECOMMENDATION}（${ROUND} 轮后），需人工介入" 2>/dev/null || true

    exit 2
    ;;
esac
