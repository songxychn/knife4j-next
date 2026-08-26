# 多 Agent 协作（可选）

默认不强制三角色。仅在**上下文会爆**或**需要独立第二意见**时拆分。

## 何时拆

| 角色 | 何时有用 |
|---|---|
| Worker | 实现/探索会塞满主会话；需要窄文件所有权 |
| Reviewer | 高风险 diff，且维护者希望另一 agent 先扫一遍 |

维护者在场时，**维护者人工审 = 合法的第二意见**，不必再开 reviewer agent。

## 角色（若使用）

**Coordinator / 主会话**

- 选任务、管分支与 issue label、写 PR 叙事
- 整合验证结果
- 可直接实现低/普通风险改动（维护者在场默认允许）

**Worker**

- 只改分配范围内的文件
- 跑分配的验证
- 返回短 handoff（见 `.agent/prompts/worker.md`）
- 不改 issue label

**Reviewer**

- 只审 diff，不继续写代码
- 对照主 issue / PR 的冻结契约审查；新增版本、模块或产品能力只能列为 `scope_followup`，不能升级为当前 PR finding
- 返回 findings + `approve | revise | block`（见 `.agent/prompts/reviewer.md`）
- 接受结论前必须用真实 `git diff` / `git show` 核对

## 审查轮次

- 默认只安排一轮全量审查和一轮定向复核。
- 主会话先汇总全量 finding，再按 `当前契约缺陷 / 无效或拒绝 / 范围外后续` 分类处置；不要每修一条就重新发起全量审查。
- 定向复核提示词必须列出要关闭的 finding、修复提交和已跑验证；reviewer 只确认这些项目，不借复核重新扫描整个 PR。
- 第三轮审查、新规范版本、新模块或外部行为变化，需要维护者明确决定后才能继续。
- 任意新 push 后，只有当前 head SHA 的审查结论有效；旧 handoff 仅作历史记录。

## 提示词

- `.agent/prompts/coordinator.md`
- `.agent/prompts/worker.md`
- `.agent/prompts/reviewer.md`

在模板后追加**当次任务**字段即可，不要改模板本体。

## Issue 状态命令

```bash
gh issue edit <N> --add-label status:in-progress
gh issue edit <N> --remove-label status:in-progress --add-label status:review   # 仅验证+审查+CI 全过后
gh issue edit <N> --remove-label status:in-progress --add-label status:blocked
gh issue close <N>   # PR 合并后
gh issue comment <N> --body "..."
```

## 冲突与失败

- 多 worker 时文件所有权不重叠
- worker 不回滚自己没做过的改动；发现意外改动就报告
- 失败：记 blocker → 缩小范围或 `status:blocked`，不要加权限盲重试
- finding 需要跨契约扩张：记后续 issue 或请维护者改契约，不在当前 review 循环中顺手实现
