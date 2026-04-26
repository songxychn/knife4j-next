# Agent 状态治理

本文件定义适合 AI 持续工作的状态模型。目标是避免 `TASKS.md` 与 `PROGRESS.md` 双写冲突，让任何一次 agent 会话都可以安全恢复、交接和审计。

## 核心原则

1. **单一事实源**：任务当前状态只允许写在 `.agent/tasks/*.yaml`。
2. **事件追加**：执行过程写入 `.agent/events/*.ndjson`，只追加，不作为当前状态源。
3. **租约开工**：开始任务前必须写 `.agent/leases/<task-id>.<agent>.json`，声明 owner、branch、expires_at。
4. **交接独立**：每次会话结束写 `.agent/runs/<run-id>.md`，记录判断、验证、风险和下一步。
5. **人类摘要可生成**：`.agent/TASKS.md` 与 `.agent/PROGRESS.md` 逐步降级为阅读视图；迁移完成后不得手工作为状态源。

## 文件职责

### `.agent/tasks/*.yaml`

任务注册表。每个任务一个文件，是任务当前状态的唯一事实源。

必须包含：

- `id`
- `status`
- `area`
- `title`
- `branch`
- `depends_on`
- `validation`
- `done_when`
- `notes`

可选包含：

- `blockers`
- `owner`
- `claimed_at`
- `updated_at`
- `handoff`

### `.agent/events/*.ndjson`

事件日志。每行一个 JSON 对象，用于审计和恢复上下文。

常见事件：

- `task.created`
- `task.claimed`
- `task.updated`
- `task.blocked`
- `task.reviewed`
- `task.completed`
- `validation.started`
- `validation.finished`
- `handoff.written`

事件日志只追加，不修改历史。如果事件写错，追加一条修正事件。

### `.agent/leases/*.json`

任务租约。用于避免多个 agent 同时修改同一任务。

租约必须包含：

- `task_id`
- `owner`
- `branch`
- `claimed_at`
- `expires_at`
- `heartbeat_at`
- `scope`

租约过期后，后续 agent 可以接管，但必须在事件日志记录 `task.lease_expired` 或 `task.takeover`。

### `.agent/runs/*.md`

会话交接记录。用于保存“本次为什么这么做”，而不是保存任务状态。

必须包含：

- run id
- task id
- branch
- changed files
- decisions
- validation
- risks
- next steps

## 状态机

允许的任务状态：

- `ready`：任务定义完整，可以被认领。
- `claimed`：已有 agent 获得租约，但尚未开始改动。
- `in_progress`：实现或验证进行中。
- `blocked`：无法继续，且有明确 blocker。
- `review`：改动完成，等待维护者或 reviewer 审查。
- `done`：已完成并合并或维护者确认无需继续。
- `cancelled`：明确放弃。

推荐流转：

```text
ready -> claimed -> in_progress -> review -> done
                         |           |
                         v           v
                      blocked     blocked
```

约束：

- `ready` 任务必须有 `validation` 和 `done_when`。
- `blocked` 任务必须有 `blockers` 和解除条件。
- `review` 任务必须有验证结果或验证例外说明。
- `done` 任务必须有完成证据，不能只写“看起来完成”。
- ad-hoc 工作也必须先创建任务，使用 `TASK-ADHOC-YYYYMMDD-NN`。

## 写入规则

### 开始任务

1. 读取 `.agent/tasks/*.yaml`，选择 `ready` 且依赖满足的任务。
2. 检查 `.agent/leases/` 是否存在未过期租约。
3. 创建租约文件。
4. 将任务状态改为 `claimed` 或 `in_progress`。
5. 追加 `task.claimed` 事件。

### 更新任务

1. 修改对应 `.agent/tasks/<task-id>.yaml`。
2. 追加 `task.updated` 事件，说明 changed fields。
3. 如果产生关键判断，写入 `.agent/runs/<run-id>.md`。

### 结束会话

1. 确保任务 YAML 的 `status` 是当前真实状态。
2. 写 run handoff。
3. 追加 `handoff.written` 事件。
4. 如果任务仍需继续，保留或刷新租约；如果不继续，删除或标记租约释放。

## 冲突解决

当文件间状态冲突时，按以下顺序判定：

1. `.agent/tasks/*.yaml` 的当前状态优先。
2. `.agent/events/*.ndjson` 用于解释状态来源。
3. `.agent/runs/*.md` 用于理解决策背景。
4. `.agent/TASKS.md` 和 `.agent/PROGRESS.md` 仅作历史摘要，不覆盖 YAML。

如果同一任务存在多个 YAML 或租约冲突，先停止实现，追加冲突事件，并请求维护者或 coordinator 处理。

## 迁移策略

短期只迁移活跃任务：`ready`、`blocked`、`review`。历史 `done` 任务暂不迁移。

迁移期间：

- `.agent/TASKS.md` 保持原内容，但新增说明指向 `.agent/tasks/`。
- `.agent/PROGRESS.md` 继续保留历史记录，但新增说明禁止写入新的权威 status。
- 新任务必须优先创建 YAML，再按需更新人类摘要。

