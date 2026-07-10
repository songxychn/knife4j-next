# 已知陷阱（高信号）

只列「违反一次就很痛」的项目特有经验。通用工程常识不写。

## 上游与复现

- **先复现再修。** upstream 问题可能在本 fork 已不存在（依赖升级、历史 fix、默认配置不同）。未复现就写 try-catch / null-guard 等于噪音；#303 是反面教材（真实是 springdoc 内 `StackOverflowError`，外层 NPE catch 拦不到）。
- **读完 upstream 正文 + 堆栈 + 评论再定本仓库范围。** 可以「受 upstream 启发做本仓增强」，但 issue 必须写明**不自认为修了 upstream #N**。
- **一分支一任务。** 不要一个 commit 绑多个 upstream 编号；smoke 必须构造报告场景再断言。

## 审查

- **Reviewer / 他人结论先用 `git show` / `git diff` 核对。** 历史案例：#198 多次 block 描述与真实 master 代码相反；按错误叙述改会把正确修复改回 bug。

## Java / Spring

- **`@Bean` 方法参数上的 `if (x == null)` 几乎是死代码**（Spring 不会注入 null）。不要包装成 bugfix。
- 兼容修复常绑 Spring Boot 2/3/4 与 jakarta 矩阵；改 starter 默认行为前先想清楚下游。

## 流程

- 所有功能改动走 PR，不直推 master。
- 不要假设一个验证命令覆盖 monorepo 所有区域。
- 范围只做任务要求的；相关改进记 follow-up，不顺手清扫。
