# 多 Agent 协作

本仓库支持浅层多 agent 工作方式，用来避免长期运行的 coordinator 背负过多实现上下文。

## 核心原则

coordinator 负责持久状态。worker 和 reviewer 负责临时上下文。

当一个有边界的 worker 能读取细节并返回紧凑 handoff 时，coordinator 不应该亲自阅读所有文件或推理所有实现细节。这样 coordinator 的上下文可以聚焦在项目意图、任务状态、安全边界和最终整合上。

**任务状态由 GitHub Issues + Labels 管理**，不再写入 `.agent/TASKS.md` 或 `.agent/PROGRESS.md`。coordinator 通过 `gh` CLI 操作 issue label 来反映状态变更。

## 角色

### Coordinator Agent

职责：

- 读取 `.agent/` 状态和 GitHub Issues
- 选择或细化一个任务（通过 issue label 操作状态）
- 判断是否委派
- 定义 worker 范围和文件所有权
- 整合结果
- 运行或核验最终验证
- 更新 issue label 和评论（**不再写 .agent/TASKS.md 或 .agent/PROGRESS.md**）
- 创建或更新 PR

coordinator 应通过要求摘要、变更路径、验证结果和风险说明来保持上下文较小，而不是保存原始探索记录。

### Worker Agent

职责：

- 执行一个有边界的实现或探索切片
- 停留在分配的文件或模块内
- 避免无关清理
- 在可行时运行分配的本地验证
- 返回简洁 handoff

worker 应是短命的。除非 coordinator 明确分配，否则 worker 不拥有任务队列状态。

### Reviewer Agent

职责：

- 检查已完成 diff 或分支
- 查找回归、范围漂移、缺失测试和不安全假设
- 只返回按严重程度排序的发现
- 除非明确要求，不要重写实现

reviewer 应尽可能接收比 worker 更少的上下文。独立审查的价值在于能发现实现者继承的假设。

## Prompt 模板

启动 OpenClaw agent 时使用这些模板：

- `.agent/prompts/openclaw-orchestrator.md` 用于长期运行的 coordinator
- `.agent/prompts/worker.md` 用于短命实现或探索 worker
- `.agent/prompts/reviewer.md` 用于独立审查 worker

coordinator 应在 worker 和 reviewer 模板后追加具体任务分配，而不是每次修改模板本身。

## 什么时候委派

适合委派：

- 任务在改动前需要阅读许多文件
- 有可并行检查的独立子区域
- reviewer 能在不阻塞实现的情况下检查已完成 diff
- coordinator 上下文会因此包含过多细节

不适合委派：

- 任务很小
- 下一步决策立即依赖结果
- 任务需要产品判断
- 多个 worker 的文件范围会重叠

## 上下文预算规则

- coordinator 上下文应保存决策，而不是原始探索。
- worker prompt 只包含任务、约束、分配文件/模块和预期 handoff 格式。
- worker 结果只有影响持久项目状态时才摘要写入 issue comment。
- 不要把长日志粘贴到 issue comment；只摘要命令、结果和 blocker。

## 委派模式

### 单 Worker

用于一个有边界的实现：

```text
Coordinator -> Worker：修复 TASK-XXX 中 Y 模块的问题。只负责 Z 路径。不要触碰其他区域。返回修改文件、验证和风险。
Worker -> Coordinator：紧凑 handoff。
Coordinator：审查、验证、更新状态。
```

### 并行探索

用于选择下一项任务或降低不确定性：

```text
Worker A：检查 Java 模块风险。
Worker B：检查文档归属表述风险。
Worker C：检查 front-core 测试缺口。
Coordinator：比较摘要后选择一个任务。
```

### 独立审查

用于 PR 前：

```text
Coordinator -> Reviewer：根据 TASK-XXX 和策略审查当前 diff。不要修改文件，只返回发现。
Reviewer -> Coordinator：发现列表或“无发现”。
Coordinator：修复、阻塞或创建 PR。
```

## Worker 必须返回的 Handoff

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

## Reviewer 必须返回的 Handoff

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

## 状态所有权

只有 coordinator 可以修改 issue 的 label 和状态。worker 不得自行修改 issue label。

coordinator 通过以下命令管理状态：

- 拾取：`gh issue edit <N> --add-label status:in-progress`
- 完成：`gh issue edit <N> --remove-label status:in-progress --add-label status:review`
- 阻塞：`gh issue edit <N> --remove-label status:in-progress --add-label status:blocked`
- 关闭：PR 合并后 `gh issue close <N>`
- 进度评论：`gh issue comment <N> --body "..."`

**不再修改** `.agent/TASKS.md` 和 `.agent/PROGRESS.md`。这两个文件已冻结，仅作历史参考。

## 冲突避免

- 使用多个 worker 时，分配互不重叠的文件所有权。
- worker 不得回滚自己未做的改动。
- worker 发现意外改动时，应报告而不是自行规范化工作区。
- coordinator 负责最终冲突解决。

## 失败处理

worker 失败时：

- 记录任务、范围和 blocker
- 不要用更宽权限盲目重试
- 要么缩小任务，要么将任务移到 `blocked`

reviewer 阻塞时：

- 如果问题属于当前范围，在当前分支修复
- 如果超出范围，记录后续任务，并说明为什么超出范围
