# AGENTS.md

本仓库面向 **维护者在场** 的 AI 辅助开发。任务状态用 **GitHub Issues + Labels** 管理。

## 开工前读什么

按任务加载，不必通读全库：

| 必读 | 何时 |
|---|---|
| 本文件 | 始终 |
| `.agent/PROJECT.md` | 改产品行为、前端线、模块边界时 |
| `.agent/RUNBOOK.md` | 选验证命令、**bug 复现**、发版验收时 |
| `.agent/KNOWN_PITFALLS.md` | 触碰 Java 兼容、bug/upstream、审查结论时 |
| `.agent/COORDINATION.md` | 交付 agent PR、安排独立审查或拆 worker 时 |

## 使命（一句话）

`knife4j-next` 是 `knife4j` 的社区维护 fork：稳住 `doc.html` 与 starter 体验，修回归与兼容，可重复发布，前端增量演进——**不是重写产品**。

## 硬约束

1. 不直接 push `master`，不代替维护者 merge PR；走分支 → PR → CI → 维护者合并。
2. 不擅自发布 release / tag、改 secrets / release 凭据、改 Maven 坐标或默认兼容承诺。维护者要求“发布新版本”且未限定语言时，授权范围为所有已具备正式发布流程的语言；范围、步骤与完成条件见 `.agent/RUNBOOK.md`“正式发布验收”。
3. 不删除大模块或重要历史路径，不用 `--no-verify`、破坏性 git 或随意 force-push 掩盖问题，除非维护者明确批准相应动作。
4. 维护者明确交付任务后，可直接完成任务内最小实现、定向测试、PR、后续 issue，以及由授权源码变更必需的生成物同步。改 CI workflow 逻辑、依赖主版本、大范围升级、新模块 / package 或任务外的产品行为，需要明确授权。
5. OAS3 新功能只进 `front/ui-react`；`front/vue3` 仅 OAS2 兼容维护，不做功能扩张。
6. 一个分支只做一件可独立验证的事；优先小而可回滚。
7. **Bug / 回归类任务先复现再修**（本仓 issue 与 upstream 关联均适用）；证据写入 issue。细则见 `.agent/RUNBOOK.md`。
8. 维护者已持续授权：本仓任务需要在 issue / PR 展示非敏感截图时，可直接运行 `./tools/upload-images.sh`。边界见 `.agent/RUNBOOK.md`。
9. 维护者要求“处理 GPT 建议”时，同时授权处理当前 PR 中 GPT / Codex 自动审查的可操作评论；采纳项实现并验证后可回复并解决线程，未采纳项只回复原因、不解决线程。不适用于人工 reviewer 评论。
10. Issue 附带的 OpenAPI / Swagger 文档须先按其声明的规范版本校验。违反规范或无法表达报告意图的文档不作为 bug 契约：要求报告者修正，不为其增加 alias、猜测或自动转换；只修等价规范夹具仍能复现的问题，非规范输入引发的崩溃或安全问题只修拒绝 / 诊断。细则见 `.agent/RUNBOOK.md`。
11. PR 审查前冻结支持版本、范围与非目标。Agent PR 须经独立 reviewer（独立 agent 或维护者人工 review），默认一轮全量 + 一轮定向复核；豁免条件、finding 处置和需停下来由维护者决定的情形见 `.agent/COORDINATION.md`。Review 评论不得隐式扩张当前 PR。
12. 任意新 push 都使旧 SHA 的 CI 与审查结论失效；修 review 用普通追加提交，不为每条评论 amend / force-push。当前 head 的本地验证、审查结论（或已写明的豁免）与 CI 全绿后，才能标 `status:review`。
13. **发布文案随发布准备 PR 一次到位**，正式 tag 不得遗留“待发布”等准备态提示；复核清单见 `.agent/RUNBOOK.md`“正式发布验收”。

需维护者决策的情形（两个合理方案外部行为不同、跨模块架构取舍、失败超出任务范围、影响 release / 兼容承诺或意图不明）：先自行调查，再说明证据与缺口，只暂停依赖该决策的步骤。

高风险变更（Java 兼容、多模块、CI / 构建 / 发布逻辑、原因未查明或仅靠重试转绿的失败、验证标准改变）由 reviewer 重点核对真实 diff 与证据，维护者决定是否追加人工审。

## 任务状态（Issue）

| Label | 含义 |
|---|---|
| `agent-task` | 可交 agent 处理的任务 |
| `status:ready` | 可拾取 |
| `status:in-progress` | 进行中 |
| `status:review` | 本地验证 + 独立审查（或低风险豁免）+ PR CI 已过，等人 merge |
| `status:blocked` | 卡决策 / 环境 / 上游 |
| `area:*` | 模块分区 |

流转：`ready` → `in-progress` → `review` →（merge 后关 issue）。

进度写在 **issue / PR**，不要另建影子任务队列。

## 默认工作方式

维护者在场时：主 agent 端到端负责复现、实现、验证和 PR；worker 仅在并行或上下文隔离有实际收益时使用。Agent PR 合入前必须经过独立 reviewer（独立 agent 或维护者人工 review），低风险纯文案修正按 `.agent/COORDINATION.md` 豁免。Bug 类路径为：复现并贴证据 → 实现 → `./tools/test-*` → 独立审查 → PR CI。细则见 `.agent/COORDINATION.md`。

分支：`agent/<task-id>-<slug>`；无 issue 的现场小改可用 `agent/adhoc-<slug>` 并在 PR 说明原因。分支名不区分具体 agent 产品。

## 验证（摘要）

| 改动 | 命令 |
|---|---|
| Java | `./tools/test-java.sh` |
| React / core / schema-engine | `./tools/test-front-core.sh` |
| Vue3（OAS2 UI） | `./tools/test-vue3.sh` |
| 文档站 | `./tools/test-docs.sh` |
| Knife4x Go | `./tools/test-knife4x-go.sh` |
| 跨区域 | 受影响区域标准脚本的并集，包含生成物与消费方影响；见 RUNBOOK |
| 全区域变更 / 整体验收 | `./tools/test-all.sh` |

优先用脚本，勿用零散 `tsc` / 单次 `vite build` 冒充全量。细节与发版验收见 `.agent/RUNBOOK.md`。

## 语言

提交、issue、PR 标题与正文使用中文；代码标识、路径、命令、label 等保留原文。

## 独立审查提示词

- `.agent/prompts/reviewer.md`
