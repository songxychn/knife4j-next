# 多 Agent 协作与工作流

## Issue-Driven 工作流

所有任务通过 GitHub Issues 管理。coordinator 通过 `gh` CLI 操作 issue label 来反映状态变更。

### 状态流转

```
backlog → in-progress → review → done（PR 合并后关闭）
         ↓
       blocked
```

### Label 规则

| Label | 含义 |
|-------|------|
| `status:backlog` | 待处理 |
| `status:in-progress` | 正在处理 |
| `status:review` | 等待审查 |
| `status:blocked` | 阻塞，需人工介入 |
| `source:im` | 来自 IM 渠道（见 im-source.md） |
| `type:bug` | 缺陷修复 |
| `type:feat` | 新功能 |
| `type:docs` | 文档改动 |
| `type:chore` | 工程维护 |

### 状态操作命令

```bash
# 拾取任务
gh issue edit <N> --add-label status:in-progress

# 完成，进入审查
gh issue edit <N> --remove-label status:in-progress --add-label status:review

# 阻塞
gh issue edit <N> --remove-label status:in-progress --add-label status:blocked

# 关闭（PR 合并后）
gh issue close <N>

# 添加进度评论
gh issue comment <N> --body "..."
```

## 分支命名

| 类型 | 格式 | 示例 |
|------|------|------|
| 功能/修复 | `fix/issue-<N>-<slug>` | `fix/issue-115-ref-description` |
| 任务 | `task/<id>-<slug>` | `task/oh-003-openhands-config` |
| Agent 任务 | `agent/TASK-<N>-<slug>` | `agent/TASK-044-settings-drawer` |

## 角色分工

- **Coordinator**：持久状态、任务调度、label 操作、PR 创建
- **Worker**：有边界的实现切片，返回 handoff，不操作 label
- **Reviewer**：独立审查 diff，只返回发现，不修改实现

## Worker Handoff 格式

```md
task:
scope:
changed_files:
- path
summary:
- fact
validation:
- command: result
risks:
- risk or none
follow_up:
- item or none
```

## Reviewer Handoff 格式

```md
task:
reviewed_scope:
findings:
- severity, file, line, explanation
validation_gaps:
- gap or none
scope_drift:
- drift or none
recommendation:
- approve | revise | block
```

## 冲突避免

- 多个 worker 时，分配互不重叠的文件所有权
- worker 不得回滚自己未做的改动
- worker 发现意外改动时，报告而不是自行规范化
- coordinator 负责最终冲突解决

## 状态所有权

只有 coordinator 可以修改 issue label 和状态。worker 不得自行修改 issue label。`.agent/TASKS.md` 和 `.agent/PROGRESS.md` 已冻结，仅作历史参考。
