# AGENTS.md

本仓库已经按 agent 自动维护的方式组织。任务状态由 **GitHub Issues + Labels** 驱动（见下方），不再使用 `.agent/TASKS.md` 和 `.agent/PROGRESS.md` 管理任务队列。

## 读取顺序

开始任何实现前，先按顺序读取：

1. `.agent/PROJECT.md`
2. `.agent/AUTONOMY_POLICY.md`
3. `.agent/COORDINATION.md`
4. `.agent/SERVER_PLAYBOOK.md`
5. `.agent/RUNBOOK.md`
6. `.agent/KNOWN_PITFALLS.md`
7. `.agent/REVIEW_POLICY.md`

未读完上述文件前，不要开始改代码。

> ⚠️ `.agent/TASKS.md` 和 `.agent/PROGRESS.md` 已于 2026-04-26 冻结，仅作历史参考。新任务状态通过 GitHub Issues 管理。

## 工作模式过渡

当前项目正在从 **OpenClaw** 迁移到 **self-hosted OpenHands**。过渡期间请注意以下事项：

1. **权威源**：`.agent/` 目录仍是所有 agent 规则和策略的权威源。`.openhands/` 是 OpenHands 读取的等价副本，两者内容应保持一致。
2. **并行运行期间的同步要求**：OpenClaw 与 OpenHands 并行运行期间，任一侧的规则修改（包括 `.agent/` 或 `.openhands/`）必须同步到另一侧，避免两套规则出现分歧。
3. **OpenHands 入口**：OpenHands agent 读取的仓库级规则位于 [`.openhands/microagents/repo.md`](.openhands/microagents/repo.md)，其内容应与 `.agent/` 保持同步。

## 项目使命

`knife4j-next` 是 `knife4j` 的社区维护 fork。当前目标不是重写项目，而是保持 `doc.html` 体验稳定、修复回归、维护兼容性、建立可重复发布流程，并以增量方式推进下一代前端。

## 任务状态管理（Issue-Driven）

任务状态通过 GitHub Issues + Labels 管理：

| Label | 含义 |
|-------|------|
| `agent-task` | 标记为 agent 自动维护的任务 |
| `status:ready` | 可被 agent 拾取 |
| `status:in-progress` | agent 正在执行 |
| `status:review` | 实现完成，等待 review/merge |
| `status:blocked` | 阻塞于决策、环境或外部依赖 |
| `area:*` | 任务所属模块（java / ui-react / front-core / docs / repo） |

**状态流转**：`ready` → `in-progress` → `review` → （PR merged → 关闭 issue）

**Agent 工作约定**：

- 优先选择小而可回滚的任务。
- 一个分支只处理一个可独立验证的任务。
- 拾取任务时，给 issue 加 `status:in-progress` label 并 assign 自己。
- 任务完成时，加 `status:review` label，创建 PR 并在 issue 中评论 PR 链接。
- PR 合并后，关闭 issue（状态自然终结）。
- 遇到阻塞时，加 `status:blocked` label 并在 issue 中评论原因，不要自行扩大范围。
- 不要让关键上下文只存在于聊天记录中，写回 issue comment 或 `.agent/`。
- **不再修改** `.agent/TASKS.md` 和 `.agent/PROGRESS.md`。

## 默认循环

1. 读取 `.agent/` 状态和 GitHub Issues（`gh issue list --label agent-task --label status:ready`）。
2. 选择一个 `status:ready` 的 issue，加 `status:in-progress` label 并 assign。
3. 根据 `.agent/COORDINATION.md` 判断直接执行还是委派给短命 agent。
4. 为任务创建或继续分支（`agent/<task-id>-<slug>`）。
5. 做满足任务的最小改动，或整合 worker 的交接结果。
6. 按 `.agent/RUNBOOK.md` 运行最窄相关验证。
7. 在 issue 中评论进度摘要。
8. 加 `status:review` label，创建或更新 PR。

## 多 Agent 规则

只使用浅层协作模型：

- 一个 coordinator agent 负责选任务、维护 issue 状态、管理分支和最终 PR 叙事。
- 短命 worker agent 可负责窄范围实现或探索。
- 短命 reviewer agent 可在 PR 前审查已完成 diff。
- **所有任务状态变更都通过 GitHub Issue label 操作，不再写 `.agent/TASKS.md` 或 `.agent/PROGRESS.md`。**

不要创建递归 agent 层级。coordinator 应该把消耗上下文的工作委派出去，并要求简洁的书面 handoff。

启动 OpenClaw agent 时使用：

- `.agent/prompts/openclaw-orchestrator.md`
- `.agent/prompts/worker.md`
- `.agent/prompts/reviewer.md`

## 分支规则

- 默认使用 `agent/<task-id>-<short-slug>`。
- 历史分支名为 `codex/<task-id>-<short-slug>` 的保留不改，仅新任务按新约定命名。
- 不要直接 push 到 `master`。
- 不要把无关修复合并到同一个分支。

## 人工升级

执行以下事项前必须停止并询问维护者：

- 修改 release 逻辑或凭据使用方式
- 发布构件
- 修改项目坐标或兼容性承诺
- 删除模块或大段历史代码
- 进行影响面不清楚的大范围依赖升级
- 处理含糊的产品方向决策

## 验证规则

每个任务必须明确：

- 目标文件或模块
- 预期行为变化
- 验证命令
- 完成条件

如果缺少这些信息，先细化任务，再开始编码。
