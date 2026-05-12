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

## 项目使命

`knife4j-next` 是 `knife4j` 的社区维护 fork。当前目标不是重写项目，而是保持 `doc.html` 体验稳定、修复回归、维护兼容性、建立可重复发布流程，并以增量方式推进下一代前端。

## 任务状态管理（Issue-Driven）

任务状态通过 GitHub Issues + Labels 管理：

| Label | 含义 |
|-------|------|
| `agent-task` | 标记为 agent 自动维护的任务 |
| `status:ready` | 可被 agent 拾取 |
| `status:in-progress` | agent 正在执行 |
| `status:review` | 本地验证、独立审查与 PR CI 均已通过，等待维护者 review/merge |
| `status:blocked` | 阻塞于决策、环境或外部依赖 |
| `area:*` | 任务所属模块（java / ui-react / front-core / docs / repo） |

**状态流转**：`ready` → `in-progress` → `review` → （PR merged → 关闭 issue）

**Agent 工作约定**：

- 优先选择小而可回滚的任务。
- 一个分支只处理一个可独立验证的任务。
- 拾取任务时，给 issue 加 `status:in-progress` label 并 assign 自己。
- 任务完成时，先创建或更新 PR 并等待独立审查和 PR CI；全部通过后，才加 `status:review` label 并在 issue 中评论 PR 链接。
- PR 合并后，关闭 issue（状态自然终结）。
- 遇到阻塞时，加 `status:blocked` label 并在 issue 中评论原因，不要自行扩大范围。
- 不要让关键上下文只存在于聊天记录中，写回 issue comment 或 `.agent/`。
- **不再修改** `.agent/TASKS.md` 和 `.agent/PROGRESS.md`。

## 语言规范

- 提交信息、议题标题、议题正文、议题评论、拉取请求标题、拉取请求描述和拉取请求评论统一使用中文。
- 避免中英混杂；只有代码标识、命令、路径、分支名、label、依赖名、API 名称等必须原样表达的内容保留原文。
- 面向维护者的工作摘要、验证说明和风险说明也使用中文。

## 默认循环

1. 读取 `.agent/` 状态和 GitHub Issues（`gh issue list --label agent-task --label status:ready`）。
2. 选择一个 `status:ready` 的 issue，加 `status:in-progress` label 并 assign。
3. 根据 `.agent/COORDINATION.md` 执行 coordinator → worker → reviewer → worker → coordinator 门禁；跳过任一角色必须记录例外原因。
4. 为任务创建或继续分支（`agent/<task-id>-<slug>`）。
5. 由 worker 做满足任务的最小改动；若符合例外条件，则由 coordinator 记录例外后直接处理。
6. 按 `.agent/RUNBOOK.md` 运行最窄相关验证。
7. 在 issue 中评论进度摘要。
8. 创建或更新 PR，等待独立 review 与 CI；全部通过后加 `status:review` label。

## 多 Agent 规则

只使用浅层协作模型：

- 一个 coordinator agent 负责选任务、维护 issue 状态、管理分支和最终 PR 叙事。
- 短命 worker agent 负责窄范围实现或探索；coordinator 默认不直接实现源码改动。
- 短命 reviewer agent 在 PR 前审查已完成 diff；没有 reviewer handoff 或明确例外记录，不得把 issue 切到 `status:review`。
- **所有任务状态变更都通过 GitHub Issue label 操作，不再写 `.agent/TASKS.md` 或 `.agent/PROGRESS.md`。**

不要创建递归 agent 层级。coordinator 应该把消耗上下文的工作委派出去，并要求简洁的书面 handoff。

默认流水线是：

```text
User/Maintainer -> Coordinator -> Worker -> Reviewer -> Worker(如需返工) -> Coordinator
```

允许跳过 worker 或 reviewer 的情况必须很窄：纯 label/issue/PR 元数据操作、极小的文档/模板文字修订，或当前运行时确实无法启动独立 agent。跳过时必须在 issue 评论或 PR 描述中写明跳过了哪个角色、原因和风险；不能把 coordinator 自查包装成独立审查。

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
