#!/usr/bin/env bash
# run-worker.sh - 只跑 worker 阶段，输出 handoff 到 stdout
#
# 用法:
#   run-worker.sh <issue_number> [reviewer_findings_file]
#
# 退出码:
#   0 - worker 完成，handoff 已输出
#   1 - 执行失败

set -euo pipefail

REPO="songxychn/knife4j-next"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CLAUDE_USER="claude-worker"

log()  { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*" >&2; }
err()  { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [ERROR] $*" >&2; }
info() { log "[INFO] $*"; }

ISSUE_NUMBER="${1:?用法: run-worker.sh <issue_number> [reviewer_findings_file]}"
FINDINGS_FILE="${2:-}"

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

# ── 构造 prompt ───────────────────────────────────────────────────────────────

REVISE_SECTION=""
if [[ -n "$FINDINGS_FILE" && -f "$FINDINGS_FILE" ]]; then
  REVIEWER_FINDINGS=$(cat "$FINDINGS_FILE")
  REVISE_SECTION="
## Reviewer Findings（需修改后重新提交）

上一轮 reviewer 审查发现以下问题，请逐条修复后重新提交 handoff：

\`\`\`
${REVIEWER_FINDINGS}
\`\`\`

修复要求：
- 针对每条 finding 说明你的处理方式
- 修改完成后重新运行验证命令确认通过
- 返回更新后的 handoff
"
fi

PROMPT="${WORKER_TEMPLATE}

Task id: issue-${ISSUE_NUMBER}
Task title: ${ISSUE_TITLE}
Issue URL: https://github.com/${REPO}/issues/${ISSUE_NUMBER}
Assigned scope: 见 issue 描述
Disallowed files: .agent/TASKS.md, .agent/PROGRESS.md
Validation command: 见 issue 描述或 .agent/RUNBOOK.md
Done condition: 代码改动完成，验证通过，返回标准 handoff
${REVISE_SECTION}
Issue body:
$(echo "${ISSUE_JSON}" | jq -r '.body // ""')
"

# ── 调用 Claude Code ──────────────────────────────────────────────────────────

TMPFILE=$(mktemp /tmp/claude-prompt-XXXXXX.txt)
printf '%s' "$PROMPT" > "$TMPFILE"
chmod 644 "$TMPFILE"

info "启动 worker..."
su -s /bin/bash "${CLAUDE_USER}" -c \
  "cd '${REPO_ROOT}' && cat '${TMPFILE}' | claude --permission-mode bypassPermissions --print"
RC=$?
rm -f "$TMPFILE"

exit $RC
