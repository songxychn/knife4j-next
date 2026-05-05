# 已知陷阱

## 项目级

- 这是一个 fork，因此部分文档、包元数据和仓库 URL 仍可能指向 upstream 历史。
- 即使澄清当前维护归属，也要保留历史署名和感谢。
- 仓库包含多个子项目，工具链和成熟度不同。不要假设一个验证命令覆盖所有区域。

## Java

- `knife4j` 是影响最大的维护区域，小改动也可能影响大量下游用户。
- 发布流程通过 `.github/workflows/release.yml` 串联；自治 agent 未经批准不得触发或修改发布流程。
- 兼容性修复通常隐藏着 Spring Boot 2.x、3.x、servlet、jakarta 等矩阵成本。

## 前端

- `knife4j-front/knife4j-core` 有直接 test/lint/build 命令，是最适合自治任务的前端区域。
- `knife4j-front/knife4j-ui-react` 属于探索区，不要通过实现暗示产品级承诺。
- 部分前端模块的 package metadata 可能仍反映 upstream 信息；除非涉及运行时行为，否则把 metadata 清理视作文档/仓库工作。

## 文档

- `README.md` 可能有意引用 upstream 作为历史或临时参考。目标是去除混淆，不是抹掉来源。
- 文档构建依赖 `npm ci`，因此环境和 lockfile 一致性很重要。

## Agent 工作流

- 不要让任务存在理由只保存在临时聊天上下文里。
- 不要把“修一个点”静默扩大成“顺手清理相关区域”。
- 不确定时，把不确定性写下来，并停在安全检查点。
- **Reviewer 声称某改动 "revert 了 X" / "删除了 Y" 时，coordinator 必须在接受结论前用 `git show <commit> -- <file>` 核对真实 diff**。历史案例：#198 三次 reviewer `block` 指控 commit `8f0d3b6f` 把 `ProductionSecurityFilter` revert 回 `sendError`、默认值 `knife4j.basic.enable` 翻转、删除 `addCustomApiDocsPathRule`，经人工复核**全部与 master 实际代码相反**；推测 reviewer 对照了 worker 未提交的 stash 或错误 base。不先核对 diff 就按 reviewer 描述动代码，会把正确修复改回 bug。
