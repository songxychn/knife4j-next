# AGENTS.md

本仓库是 `xiaoymin/knife4j` 的社区维护 fork：稳住 `doc.html` 与 starter 体验，修回归与兼容，可重复发布，前端增量演进——**不是重写产品**。任务状态用 GitHub Issues + Labels 管理。

## 按需阅读

- `.agent/PROJECT.md`：产品边界与两条前端线
- `.agent/RUNBOOK.md`：验证命令、Bug 复现、发布验收
- `.agent/KNOWN_PITFALLS.md`：项目特有踩坑
- `.agent/COORDINATION.md`：独立审查与多 agent 协作

## 核心约束

1. **分支与合并**：不直接 push `master`，不代替维护者 merge PR；走分支 → PR → CI → 维护者合并。分支命名：`agent/<task-id>-<slug>`（无 issue 可用 `agent/adhoc-<slug>`）。
2. **发布与高风险授权**：不擅自发布 release / tag、改 secrets 或 Maven 坐标；改 CI workflow、依赖主版本、新模块或任务外产品行为需明确授权。维护者要求“发布新版本”且未限定语言时，覆盖所有已具备正式发布流程的语言（当前为 Java 与 Knife4x Go）。
3. **两条前端线**：OAS3 新功能只进 `front/ui-react`；`front/vue3` 仅 OAS2 兼容维护，不做功能扩张。
4. **先复现再修**：Bug / 回归任务先在未打补丁基线复现并留证据，再修复。禁止空想 try-catch / null-guard 防御性补丁。
5. **不兼容非规范文档**：附带 OpenAPI / Swagger 文档的 issue 先按声明版本核对规范；不为违反规范的文档加 alias、猜测或自动转换（崩溃/安全问题只修安全拒绝）。
6. **小步可回滚**：一个分支只做一件可独立验证的事；不用 `--no-verify` 或随意 force-push。
7. **发布文案一次到位**：发布准备 PR 同步版本入口文案，正式 tag 不留“待发布”提示。
8. **截图上传**：本仓 issue / PR 展示非敏感截图可直接运行 `./tools/upload-images.sh`（上传前须遮盖 Token / Cookie 等凭据）。

## 验证命令

| 改动区域 | 命令 |
|---|---|
| Java（`knife4j/`） | `./tools/test-java.sh` |
| React / core / schema-engine | `./tools/test-front-core.sh` |
| Vue3（OAS2 UI） | `./tools/test-vue3.sh` |
| 文档站（`docs/`） | `./tools/test-docs.sh` |
| Knife4x Go | `./tools/test-knife4x-go.sh` |
| 全区域验收 | `./tools/test-all.sh` |

优先用脚本，勿用零散 `tsc` / 单次 `vite build` 冒充全量。

## 语言与状态

- 提交、issue、PR 标题与正文使用中文；代码标识、路径、命令、label 保留原文。
- Issue 状态流转：`status:ready` → `status:in-progress` → `status:review`（本地验证 + 审查 + CI 全绿）→ merge 后关闭；阻塞标 `status:blocked`。
