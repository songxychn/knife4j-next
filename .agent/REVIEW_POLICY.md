# 审查策略

自治工作只有在审查成本低且可信时才有价值。

## 审查重点

1. 行为回归风险
2. 兼容性影响
3. 验证质量
4. 范围纪律
5. 相关迁移说明或 release note 是否清楚

## Agent 必须提供

- 精确 task id
- 为什么选择这个任务
- 修改文件
- 验证命令和结果
- worker handoff 摘要，或跳过 worker 的明确例外原因
- reviewer handoff 摘要，或跳过 reviewer 的明确例外原因
- 明确风险说明
- 如果工作不完整，列出明确后续事项

## 独立 Reviewer Agent

除纯 label/issue/PR 元数据操作外，agent 产出的 PR 默认需要独立 reviewer。以下情况是硬触发条件，满足任一项时，未获得 reviewer handoff 不得创建“已完成”叙事，也不得把 issue 切到 `status:review`：

- 实现由 worker 完成
- diff 修改 Java 兼容性行为
- 任务触碰多个模块
- 验证曾失败，后来才通过
- coordinator 对 diff 的回归风险没有足够把握

reviewer 应根据 `.agent/PROJECT.md`、`.agent/AUTONOMY_POLICY.md`、`.agent/RUNBOOK.md` 和目标任务审查 diff。除非被明确重新分配为 worker，reviewer 不应继续实现。

coordinator 给 reviewer 的输入必须包含：

- issue 编号、标题、目标文件或模块、预期行为变化和完成条件
- 当前分支或 diff 范围
- 变更文件列表
- 声称的行为变化
- 已运行的验证命令与结果
- 已知风险、范围外事项和 reviewer 约束

如果当前运行时无法启动独立 reviewer，必须把限制写入 issue 评论或 PR 描述。此时不能声称“已独立审查”；高风险触发条件下应停在人工 review，而不是自动切 `status:review`。

## Reviewer 结论处理

- `approve`：coordinator 可继续 PR/CI/状态流转。
- `revise`：必须修复或明确暂缓；默认交回 worker 修改。
- `block`：必须修复或升级维护者；不得切 `status:review`。
- `high` 级发现等同阻断。
- `medium` 级发现默认处理；若暂缓，必须写明理由。
- `low` / `info` 可暂缓，但必须在 PR 或 issue 中记录。

## 推荐 PR 大小

- 一个 PR 对应一个任务
- 一个 PR 只覆盖一个主要区域
- 一个 PR 只表达一个主要主张

## 拒绝条件

如果出现以下情况，应退回自治工作：

- 范围漂移超出任务
- 缺少验证，或无解释地降低验证标准
- 忽略 `.agent/PROJECT.md` 中的项目意图
- 未解释为何跳过更安全的增量方案
- 改动制造隐藏维护负担

## 合并就绪

任务满足以下条件时才算可合并：

- 任务状态为 `review`
- 验证通过，或验证例外得到维护者明确批准
- 独立 reviewer 已返回 `approve`，或跳过 reviewer 的例外得到明确记录
- PR 描述用仓库语义说明影响，而不是泛泛的 AI 叙述
