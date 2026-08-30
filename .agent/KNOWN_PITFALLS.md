# 已知陷阱（高信号）

只列「违反一次就很痛」的项目特有经验。通用工程常识不写。

## 复现

- **upstream 问题可能在本 fork 已不存在**（依赖升级、历史 fix、默认配置不同）。#303 是反面教材（真实是 springdoc 内 `StackOverflowError`，外层 NPE catch 拦不到）。

## 审查

- **Reviewer / 他人结论先用 `git show` / `git diff` 核对。** 历史案例：#198 多次 block 描述与真实 master 代码相反；按错误叙述改会把正确修复改回 bug。

## Java / Spring

- **`@Bean` 方法参数上的 `if (x == null)` 几乎是死代码**（Spring 不会注入 null）。不要包装成 bugfix。
- 兼容修复常绑 Spring Boot 2/3/4 与 jakarta 矩阵；改 starter 默认行为前先想清楚下游。
