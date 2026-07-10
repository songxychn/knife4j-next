# 工作手册（维护者在场）

默认路径：**维护者 + 当前 agent 端到端**。不假设无人值守或定时唤醒。

## 快速入口

```bash
./tools/agent-status.sh snapshot   # 工作区 + 当前 PR + 进行中/可拾取任务
./tools/agent-status.sh            # 任务看板
```

## 循环

1. 读 `AGENTS.md`；按任务补读 `.agent/PROJECT.md` / `RUNBOOK.md` 等。
2. 确认任务：维护者指定，或 `agent-task` + `status:ready` 的 issue。
3. 可执行性检查（见下）；缺信息先补 issue 或问维护者。
4. 开/切分支：`agent/<task-id>-<slug>`（无 issue：`agent/codex-<slug>`）。
5. 最小改动；不夹带无关清理。
6. 跑 `.agent/RUNBOOK.md` 中最窄验证。
7. 开/更新 PR，`gh pr checks <N> --watch`。
8. 本地验证 + 审查结论 + CI 全绿后，才把 issue 标 `status:review`。

## 可执行性检查

实现前至少明确：

- 目标文件或模块
- 预期行为变化
- 验证命令
- 完成条件
- 风险与是否需要人工决策

Upstream 相关还必须：

- 读完 upstream 原文、堆栈、截图与评论
- 在本仓库能否复现（见 RUNBOOK）
- 若只是衍生范围，issue 须写明**不自认为修了 upstream**

## 风险与审查

| 级别 | 例子 | 做法 |
|---|---|---|
| 低 | label、文案、流程文档、无行为变化的笔误 | 单 agent 即可；PR 写清验证 |
| 普通 | 单模块前端/文档/测试、行为清晰、回滚简单 | 单 agent + 对应 `tools/test-*`；维护者可人工审 |
| 高 | Java 兼容、多模块、CI/构建/发布逻辑、验证曾红后才绿 | 需要第二意见：独立 reviewer agent **或** 维护者人工审；接受结论前用 `git diff`/`git show` 核对 |
| 必须问人 | 发版、改坐标/凭据、删大段历史、大范围依赖升级、产品方向 | 停止，等维护者 |

维护者在场时，**人工 review 可以替代独立 reviewer agent**。不要为了角色齐全而硬拆会话。

## Issue 评论

不必写每个中间想法。建议节点：接手 / blocker / 完成验证 / 开 PR / CI 结果 / 审查结论。只摘要命令与结果，不贴长日志。

## PR 描述

- 关联 issue（或说明无 issue 的原因）
- 变更范围
- 验证命令与结果
- 风险与范围外事项
- 若跳过独立 reviewer，写明由谁审、结论如何

## 停止条件

- 任务完成且 PR/验证状态写清
- 需要维护者做产品或发布决策
- 继续尝试只会扩大范围
- 工作区出现非本任务改动或异常冲突
- 验证失败超出当前任务范围
