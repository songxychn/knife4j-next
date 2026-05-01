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
MAX_REVISE_ROUNDS=2

log()  { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"; }
err()  { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [ERROR] $*" >&2; }
info() { log "[INFO] $*"; }
warn() { log "[WARN] $*"; }

# ── 参数 ──────────────────────────────────────────────────────────────────────
ISSUE_NUMBER="${1:?用法: trigger-task.sh <issue_number>}"

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

# ── Git worktree 管理 ─────────────────────────────────────────────────────────
# 每次从干净的 master 创建独立 worktree，避免旧 branch 上的历史 commit 污染

BRANCH="agent/issue-${ISSUE_NUMBER}-$(date +%s)"
WORKTREE_DIR="/tmp/worktree-issue-${ISSUE_NUMBER}"

setup_worktree() {
  # 清理可能残留的旧 worktree
  if [[ -d "${WORKTREE_DIR}" ]]; then
    warn "清理残留 worktree: ${WORKTREE_DIR}"
    git -C "${REPO_ROOT}" worktree remove --force "${WORKTREE_DIR}" 2>/dev/null || true
    rm -rf "${WORKTREE_DIR}"
  fi

  # 确保本地 master 是最新的
  info "更新 master..."
  git -C "${REPO_ROOT}" fetch origin master
  git -C "${REPO_ROOT}" checkout master
  git -C "${REPO_ROOT}" merge --ff-only origin/master 2>/dev/null || true

  # 创建新 worktree，从 master 开一个干净的新 branch
  info "创建 worktree: ${WORKTREE_DIR} (branch: ${BRANCH})"
  git -C "${REPO_ROOT}" worktree add "${WORKTREE_DIR}" -b "${BRANCH}" master

  # worktree 里的 git remote 和 SSH 配置继承自主仓库，无需额外配置
  info "Worktree 就绪"
}

cleanup_worktree() {
  if [[ -d "${WORKTREE_DIR}" ]]; then
    info "清理 worktree: ${WORKTREE_DIR}"
    git -C "${REPO_ROOT}" worktree remove --force "${WORKTREE_DIR}" 2>/dev/null || true
    rm -rf "${WORKTREE_DIR}"
  fi
}

# 确保退出时清理 worktree
trap cleanup_worktree EXIT

setup_worktree

# ── Claude Code 调用（每次都是独立的新进程）──────────────────────────────────

run_claude() {
  local prompt="$1"
  local workdir="${2:-${WORKTREE_DIR}}"
  local tmpfile
  tmpfile=$(mktemp /tmp/claude-prompt-XXXXXX.txt)
  printf '%s' "$prompt" > "$tmpfile"
  chmod 644 "$tmpfile"
  # 每次调用都是全新的 su + claude 进程，不共享上下文
  # worker 在 worktree 目录里工作，reviewer 在主仓库目录里工作
  su -s /bin/bash "${CLAUDE_USER}" -c \
    "cd '${workdir}' && cat '${tmpfile}' | claude --permission-mode bypassPermissions --print"
  local rc=$?
  rm -f "$tmpfile"
  return $rc
}

# ── run_worker ────────────────────────────────────────────────────────────────

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
- 只修改 Allowed files 范围内的文件
- 修改完成后重新运行验证命令确认通过
- 返回更新后的 handoff
"
  fi

  local prompt="${WORKER_TEMPLATE}

Task id: issue-${ISSUE_NUMBER}
Task title: ${ISSUE_TITLE}
Issue URL: https://github.com/${REPO}/issues/${ISSUE_NUMBER}
Assigned scope: 见 issue 描述
Allowed files or modules: 见 issue 描述中的「相关文件」部分；如未列出，默认只允许修改与 issue 直接相关的文件
Disallowed files: .agent/TASKS.md, .agent/PROGRESS.md，以及所有与本 issue 无关的文件
Validation command: 见 issue 描述或 .agent/RUNBOOK.md
Done condition: 代码改动完成，验证通过，返回标准 handoff
Extra constraints: 你在独立的 git worktree 中工作（${WORKTREE_DIR}），branch 是 ${BRANCH}，从干净的 master 开始。不要切换 branch，不要操作主仓库目录。
${revise_section}
Issue body:
$(echo "${ISSUE_JSON}" | jq -r '.body // ""')
"

  # worker 在 worktree 里工作
  run_claude "$prompt" "${WORKTREE_DIR}"
}

# ── run_reviewer（独立新进程，在主仓库目录工作）──────────────────────────────

run_reviewer() {
  local worker_output="$1"

  # 推送 branch 到远端，reviewer 通过 fetch 拿到最新 diff
  info "推送 branch ${BRANCH} 到远端供 reviewer 使用..."
  git -C "${WORKTREE_DIR}" push -u origin "${BRANCH}" 2>&1 || true

  local diff
  diff=$(git -C "${REPO_ROOT}" fetch origin "${BRANCH}" 2>/dev/null && \
         git -C "${REPO_ROOT}" diff "master...origin/${BRANCH}" 2>/dev/null | head -500 || \
         echo "(diff unavailable)")

  local prompt="${REVIEWER_TEMPLATE}

Task id: issue-${ISSUE_NUMBER}
Branch to review: ${BRANCH}
Issue URL: https://github.com/${REPO}/issues/${ISSUE_NUMBER}
Reviewer constraints: 只返回 findings，不修改代码

Worker handoff:
${worker_output}

Diff (first 500 lines):
${diff}
"

  # reviewer 在主仓库目录工作（独立进程，不继承 worker 上下文）
  run_claude "$prompt" "${REPO_ROOT}"
}

# ── parse_recommendation ──────────────────────────────────────────────────────

parse_recommendation() {
  local output="$1"
  local rec
  rec=$(echo "${output}" | grep -oiP 'recommendation[:\s]+\K(approve|revise|block)' | head -1 || true)
  if [[ -z "$rec" ]]; then
    rec=$(echo "${output}" | grep -iA1 '^recommendation:' | grep -oiP '(approve|revise|block)' | head -1 || true)
  fi
  if [[ -z "$rec" ]]; then
    rec=$(echo "${output}" | grep -iP '^[-*]\s*(approve|revise|block)\s*$' | head -1 | grep -oiP 'approve|revise|block' || true)
  fi
  if [[ -z "$rec" ]]; then
    rec=$(echo "${output}" | grep -oiP 'Review\s+Result[:\s]+\K(approve|revise|block)' | head -1 || true)
  fi
  if [[ -z "$rec" ]]; then
    rec=$(echo "${output}" | grep -oiP '\b(approve|revise|block)\b' | tail -1 || true)
  fi
  echo "${rec}" | tr '[:upper:]' '[:lower:]' | tr -d ' '
}

# ── 主循环：worker → reviewer，最多 MAX_REVISE_ROUNDS 轮 ─────────────────────

WORKER_OUTPUT=""
REVIEWER_OUTPUT=""
RECOMMENDATION=""
ROUND=0
REVIEWER_FINDINGS=""

while [[ $ROUND -lt $MAX_REVISE_ROUNDS ]]; do
  ROUND=$(( ROUND + 1 ))
  info "=== Round ${ROUND}/${MAX_REVISE_ROUNDS} ==="

  # Phase 1: Worker（在 worktree 里工作）
  info "--- Phase 1: Worker (worktree: ${WORKTREE_DIR}) ---"
  WORKER_OUTPUT=$(run_worker "${REVIEWER_FINDINGS}") || {
    err "Worker 执行失败（round ${ROUND}）"
    gh issue comment "${ISSUE_NUMBER}" --repo "${REPO}" \
      --body "❌ Worker 执行失败（round ${ROUND}），需人工介入。" 2>/dev/null || true
    exit 1
  }
  info "Worker 完成，输出长度: ${#WORKER_OUTPUT}"
  echo "${WORKER_OUTPUT}" | tail -30

  # Phase 2: Reviewer（在主仓库目录，独立新进程）
  info "--- Phase 2: Reviewer (new process, main repo) ---"
  REVIEWER_OUTPUT=$(run_reviewer "${WORKER_OUTPUT}") || {
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

    PR_URL=$(gh pr create \
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
    gh pr checks "${PR_NUMBER}" --repo "${REPO}" --watch || {
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
