# AGENTS.md

本仓库已经按 agent 自动维护的方式组织。任何在本仓库工作的 agent，都必须把 `.agent/` 目录视为项目意图、任务状态、权限边界和交接记录的事实来源。

## 读取顺序

开始任何实现前，先按顺序读取：

1. `.agent/PROJECT.md`
2. `.agent/AUTONOMY_POLICY.md`
3. `.agent/COORDINATION.md`
4. `.agent/SERVER_PLAYBOOK.md`
5. `.agent/RUNBOOK.md`
6. `.agent/TASKS.md`
7. `.agent/PROGRESS.md`
8. `.agent/KNOWN_PITFALLS.md`
9. `.agent/REVIEW_POLICY.md`

未读完上述文件前，不要开始改代码。

## 项目使命

`knife4j-next` 是 `knife4j` 的社区维护 fork。当前目标不是重写项目，而是保持 `doc.html` 体验稳定、修复回归、维护兼容性、建立可重复发布流程，并以增量方式推进下一代前端。

## Agent 工作约定

- 优先选择小而可回滚的任务。
- 一个分支只处理一个可独立验证的任务。
- 将进度持久写入 `.agent/PROGRESS.md`。
- 任务状态变化时更新 `.agent/TASKS.md`。
- 遇到阻塞时记录 blocker，不要自行扩大范围。
- 不要让关键上下文只存在于聊天记录中，必须写回 `.agent/`。

## 默认循环

1. 读取 `.agent/` 状态。
2. 从 `.agent/TASKS.md` 选择一个 `ready` 任务。
3. 根据 `.agent/COORDINATION.md` 判断直接执行还是委派给短命 agent。
4. 为任务创建或继续分支。
5. 做满足任务的最小改动，或整合 worker 的交接结果。
6. 按 `.agent/RUNBOOK.md` 运行最窄相关验证。
7. 更新 `.agent/PROGRESS.md` 和 `.agent/TASKS.md`。
8. 任务可审查时创建或更新 PR。

## 多 Agent 规则

只使用浅层协作模型：

- 一个 coordinator agent 负责选任务、维护状态、管理分支和最终 PR 叙事。
- 短命 worker agent 可负责窄范围实现或探索。
- 短命 reviewer agent 可在 PR 前审查已完成 diff。

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
