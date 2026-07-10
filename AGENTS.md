# AGENTS.md

本仓库面向 **维护者在场** 的 AI 辅助开发。任务状态用 **GitHub Issues + Labels** 管理。

## 开工前读什么

按任务加载，不必通读全库：

| 必读 | 何时 |
|---|---|
| 本文件 | 始终 |
| `.agent/PROJECT.md` | 改产品行为、前端线、模块边界时 |
| `.agent/AUTONOMY_POLICY.md` | 不确定能不能改某类东西时 |
| `.agent/RUNBOOK.md` | 需要选验证命令、发版验收、复现 upstream 时 |
| `.agent/KNOWN_PITFALLS.md` | 触碰 Java 兼容、upstream、审查结论时 |
| `.agent/PLAYBOOK.md` | 需要完整工作循环时 |
| `.agent/COORDINATION.md` | 需要拆 worker / 独立 reviewer 时 |

## 使命（一句话）

`knife4j-next` 是 `knife4j` 的社区维护 fork：稳住 `doc.html` 与 starter 体验，修回归与兼容，可重复发布，前端增量演进——**不是重写产品**。

## 硬约束

1. 不直接 push `master`；走分支 → PR → CI → 合并。
2. 不擅自发版、改 secrets / release 凭据、改 Maven 坐标或默认兼容承诺。
3. 不删除大模块或重要历史路径，除非维护者明确批准。
4. OAS3 新功能只进 `front/ui-react`；`front/vue3` 仅 OAS2 兼容维护，不做功能扩张。
5. 一个分支只做一件可独立验证的事；优先小而可回滚。

## 任务状态（Issue）

| Label | 含义 |
|---|---|
| `agent-task` | 可交 agent 处理的任务 |
| `status:ready` | 可拾取 |
| `status:in-progress` | 进行中 |
| `status:review` | 本地验证 + 审查（人或独立 reviewer）+ PR CI 已过，等人 merge |
| `status:blocked` | 卡决策 / 环境 / 上游 |
| `area:*` | 模块分区 |

流转：`ready` → `in-progress` → `review` →（merge 后关 issue）。

进度写在 **issue / PR**，不要另建影子任务队列。

## 默认工作方式

维护者在场时：**单 agent 端到端** 即可（实现 → `./tools/test-*` → PR → 等 CI）。  
高风险改动需要第二意见（独立 agent 或维护者人工审），见 `.agent/COORDINATION.md` 与 `.agent/PLAYBOOK.md`。

分支：`agent/<task-id>-<slug>`；无 issue 的现场小改可用 `agent/codex-<slug>` 并在 PR 说明原因。

## 验证（摘要）

| 改动 | 命令 |
|---|---|
| Java | `./tools/test-java.sh` |
| React / core | `./tools/test-front-core.sh` |
| Vue3（OAS2 UI） | `./tools/test-vue3.sh` |
| 文档站 | `./tools/test-docs.sh` |
| 跨区域 | `./tools/test-all.sh` |

优先用脚本，勿用零散 `tsc` / 单次 `vite build` 冒充全量。细节与发版验收见 `.agent/RUNBOOK.md`。

## 语言

提交、issue、PR 标题与正文使用中文；代码标识、路径、命令、label 等保留原文。

## 可选提示词

- `.agent/prompts/coordinator.md`
- `.agent/prompts/worker.md`
- `.agent/prompts/reviewer.md`
