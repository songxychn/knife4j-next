<!--
本模板同时服务人工贡献者与 agent。
请在提交 PR 前完成下方各项；对不适用的项勾 [x] 并在后面注明 "N/A + 原因"。
-->

## 关联 issue

<!-- 每个 PR 应只关联一条主 issue。upstream issue 不是本仓库 issue，不要直接写 "fix upstream #xxx"。 -->

- Closes #
- （可选）upstream 灵感来源：<https://github.com/xiaoymin/knife4j/issues/>

## 变更摘要

<!-- 2–5 行说明本 PR 做了什么、不做什么。避免"顺手清理"。 -->

## Upstream issue 处理自检

> 如果本 PR **不涉及** upstream issue，请在每项后写 "N/A"。

- [ ] 本 PR 只关联 **≤1 条** upstream issue（不在同一 commit / PR 中批量声明修多个 upstream）
- [ ] 已通读 upstream 原文（描述 + 堆栈 + 评论 + 复现截图），本仓库 issue 正文摘录了关键片段
- [ ] 已在 `knife4j-smoke-tests/` 或本地最小工程**复现** upstream 报告的具体场景（贴出复现前的失败输出）
- [ ] 本 PR 的 smoke test **能区分**修复前后的行为（去掉修复，测试应变红）；不要依赖"只断言 200"的弱断言
- [ ] 若本仓库范围与 upstream 诉求不同，issue 正文已**显式声明换了范围**（不自认为修了 upstream #xxx）

## 影响面自检

- [ ] 本 PR **未**修改发布流程 / 项目坐标 / 兼容性承诺（如需修改，已在 issue 评论中请示维护者）
- [ ] 如果碰了 Java 核心 starter / filter / autoconfiguration，已勾选以下高影响区并说明理由：
  - [ ] `knife4j-openapi2-spring-boot-starter`
  - [ ] `knife4j-openapi3-spring-boot-starter`
  - [ ] `knife4j-openapi3-jakarta-spring-boot-starter`
  - [ ] `knife4j-gateway-spring-boot-starter`
  - [ ] `knife4j-aggregation-*-starter`
  - [ ] `knife4j-core` 的 filter / security / config

## 验证

<!-- 列出实际跑了哪些命令 / 测试 / 手动验证步骤。 -->

- [ ] 相关 smoke-tests 模块 `mvn -pl ... -am test` 通过
- [ ] 如涉及前端：`knife4j-front/knife4j-core` 或 `knife4j-ui-react` 的 test / build 通过
- [ ] 如涉及文档：`docs-site` 本地构建通过

```
# 粘贴关键命令输出
```

## 流程自检

- [ ] 分支名符合 `agent/<task-id>-<slug>` 或 `codex/<task-id>-<slug>` 约定（agent 产出）
- [ ] commit message 关联 issue ≤1 条；未在同一分支混入无关修复
- [ ] 未把 Java 核心逻辑改动夹带在"标题是文档/UI"的 PR 中
- [ ] 未绕过 PR 直推 master；未 force push 到 `master`

<!--
参考资料：
- .agent/RUNBOOK.md —— upstream issue 复现工作流
- .agent/KNOWN_PITFALLS.md —— 历史误读 / 违规案例
- .agent/REVIEW_POLICY.md —— review 前必须核对真实 diff
-->

