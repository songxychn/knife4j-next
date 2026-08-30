# 工作手册（维护者在场）

默认路径：**主 agent 端到端交付 + 独立 reviewer 审查**。worker 按需使用，不假设无人值守或定时唤醒。

## 快速入口

```bash
./tools/agent-status.sh snapshot   # 工作区 + 当前 PR + 进行中/可拾取任务
./tools/agent-status.sh            # 任务看板
```

## 循环

1. 读 `AGENTS.md`；按任务补读 `.agent/PROJECT.md` / `RUNBOOK.md` 等。
2. 确认任务：维护者指定，或 `agent-task` + `status:ready` 的 issue。
3. 可执行性检查（见下）；缺信息先补 issue 或问维护者。
4. **Bug 类任务：先按 RUNBOOK 复现并贴证据，再写修复。**
5. 开/切分支：`agent/<task-id>-<slug>`（无 issue：`agent/codex-<slug>`）。
6. 最小改动；不夹带无关清理。
7. 跑 `.agent/RUNBOOK.md` 中最窄验证。
8. 开/更新 PR，记录契约快照；由独立 reviewer 对当前 head 做全量审查，主 agent 批量处理 finding 后再做定向复核。
9. 运行 `gh pr checks <N> --watch`；当前 head SHA 的本地验证 + 独立审查结论 + CI 全绿后，才把 issue 标 `status:review`。

## 可执行性检查

实现前至少明确：

- 目标文件或模块
- 预期行为变化
- 验证命令
- 完成条件
- 风险与是否需要人工决策

**Bug / 回归 / 错误行为**（本仓 issue 与 upstream 关联均适用）还必须：

- 在未打补丁基线上复现成功，证据已写进 issue（见 RUNBOOK「Bug 复现」）
- 或已说明复现失败并 `blocked` / close——**不得**在未复现时直接写修复

Upstream 关联额外：

- 读完 upstream 原文、堆栈、截图与评论
- 若只是衍生范围，issue 须写明**不自认为修了 upstream**

## 契约与独立审查

首次实现或审查前，在主 issue / PR 明确一份契约快照：

- 支持的规范与版本
- 范围内模块、对象和外部行为
- 明确非目标及对应后续 issue（若已有）
- 验证命令与完成条件

每个 agent PR 都必须由当前实现上下文之外的独立 reviewer 审查；维护者人工 review 也满足独立性。审查者自行读取冻结契约与真实 diff，不以主 agent 摘要代替证据。默认只做一轮全量审查和一轮定向复核，finding 的分类、停止条件、输入输出契约见 `.agent/COORDINATION.md`。

Review 修复使用普通追加提交，不为每条评论 amend / force-push。任意 push 都使旧 SHA 的 CI、review 与 `status:review` 失效，必须对当前 head 重新满足门禁。

## 风险与审查

| 级别 | 例子 | 做法 |
|---|---|---|
| 低 | label、文案、流程文档、无行为变化的笔误 | 主 agent + 轻量独立审查；PR 写清验证 |
| 普通 | 单模块前端/文档/测试、行为清晰、回滚简单 | 主 agent + 对应 `tools/test-*` + 独立审查 |
| 高 | Java 兼容、多模块、CI/构建/发布逻辑、验证曾红后才绿 | 独立 reviewer 重点核对真实 diff 与证据；维护者决定是否追加人工审 |
| 必须问人 | 发版、改坐标/凭据、删大段历史、大范围依赖升级、产品方向 | 停止，等维护者 |

维护者在场时，**人工 review 可以替代独立 reviewer agent**。worker 仍然可选，不要为了角色齐全而硬拆实现工作。

## Issue 评论

不必写每个中间想法。建议节点：接手 / blocker / 完成验证 / 开 PR / CI 结果 / 审查结论。只摘要命令与结果，不贴长日志。

## PR 描述

- 关联 issue（或说明无 issue 的原因）
- 契约快照：支持版本、范围内对象、非目标
- 变更范围
- 验证命令与结果
- 独立 reviewer、审查所绑定的 head SHA 与 finding 处置（修复 / 拒绝 / 后续 issue）
- 风险与范围外事项

## 停止条件

- 任务完成且 PR/验证状态写清
- 需要维护者做产品或发布决策
- 继续尝试只会扩大范围
- 工作区出现非本任务改动或异常冲突
- 验证失败超出当前任务范围
