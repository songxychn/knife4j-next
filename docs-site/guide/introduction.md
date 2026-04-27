---
title: 产品介绍
---

# 产品介绍

`knife4j-next` 是 [`xiaoymin/knife4j`](https://github.com/xiaoymin/knife4j) 的社区维护 fork，延续 `doc.html` 的接入习惯与 starter 模块结构，在 upstream 发布节奏放缓时接续安全修复、兼容性修复和发布流程。

## 与 upstream 的关系

| 维度 | upstream `knife4j` | `knife4j-next`（本项目） |
| --- | --- | --- |
| Maven `groupId` | `com.github.xiaoymin` | `com.baizhukui` |
| artifactId | 保留 | 完全一致，可直接替换 |
| Java 包名 | `com.github.xiaoymin.knife4j.*` | 同上（未重命名，降低迁移成本） |
| `knife4j.*` 配置键 | 保留 | 完全兼容 |
| 访问入口（doc.html / v2 / v3 api-docs） | 保留 | 完全一致 |
| 仓库 | `xiaoymin/knife4j` | [`songxychn/knife4j-next`](https://github.com/songxychn/knife4j-next) |
| 发布渠道 | Maven Central | Maven Central |
| 当前版本 | `4.6.0` | `5.0.0-SNAPSHOT` |
| 文档站 | [doc.xiaominfo.com](https://doc.xiaominfo.com/) | 本站（`knife4jnext.com`） |

**迁移的最小单位是改 `groupId`，业务代码、配置键、访问路径都不必动。** 详见 [迁移指引](./migration)。

## 这份 fork 想解决什么

1. **兼容性修复**。upstream 对 Spring Boot 3.4 / 3.5 的适配步伐变慢，fork 已经升级 `springdoc-openapi-jakarta` 到 `2.8.9`，把 3.4.0 / 3.5.0 两个版本纳入 smoke-tests 模块定期回归。
2. **安全修复**。修复了 `/v2/api-docs;xxx` 分号绕过 Basic 认证的漏洞（[#886](https://github.com/xiaoymin/knife4j/issues/886)），以及 gateway `context-path` 下聚合 host 少斜杠的问题（[#954](https://github.com/xiaoymin/knife4j/issues/954)）。
3. **可重复发布流程**。`.github/workflows/release.yml` 通过 Central Publishing Plugin 直接推送 Maven Central，不依赖人工临场操作。
4. **可试用的 Demo**。`knife4j-demo` 模块提供完整的 Spring Boot 3.4 示例工程 + Dockerfile + docker-compose.yml。

## 哪些是 **已经** 做了的

下表仅列 **`master` 已合并** 的工作，不是路线图承诺。

| 方向 | 已合并 | 对应资料 |
| --- | --- | --- |
| Boot 2.7.18 starter + UI webjar | ✅ | [快速开始](./getting-started) |
| Boot 3.4.0 / 3.5.0 兼容 | ✅ | smoke-tests 模块 `boot3-jakarta-app`、`boot35-jakarta-app` |
| /doc.html 分号绕过修复 | ✅ `#886` | [发布说明](../release-notes/) |
| Gateway context-path 修复 | ✅ `#954` | [Gateway 接入](./gateway) |
| React + Vite 新前端 webjar | ✅ | 在 `knife4j-openapi3-ui` 生效；`knife4j-openapi2-ui` 继续用 Vue2 |
| 设置面板（Authorize / GlobalParam / OfflineDoc） | ✅ | 新前端右上角入口 |
| `knife4j-demo` Docker Compose | ✅ | [Demo 预览](./demo) |
| `com.baizhukui` 坐标发布 | ✅ | Maven Central |

## 哪些是 **没有** 做或 **部分实现**，需要你知道

upstream 文档里列出的 29 个增强特性在本 fork 的实际实现状态，前端和后端存在差异：

| 情况 | 数量 | 示例 | 建议 |
| --- | --- | --- | --- |
| 全部模块已实现 | 4 项 | `knife4j.enable`、`knife4j.production`、`knife4j.basic`、JSR303 透传 | 安心使用 |
| openapi2-starter 完整，openapi3 系列**部分丢弃** | 6 项 | `@DynamicParameters`、`@DynamicResponseParameters`、`@ApiOperationSupport(ignoreParameters/includeParameters)` 等 Springfox 专属能力 | 迁到 openapi3 时改用实体类替代 |
| 后端实现，新 React 前端未读取 | 13 项 | `knife4j.setting.enable-debug=false`、`enable-search`、`enable-open-api`、`enable-version`、`enable-footer-custom`、`home-custom-path`、`swagger-model-name`、`enable-after-script` 等 | 依赖这些 UI 开关的用户暂时使用 openapi2 + Vue2 UI |
| 全模块未实现 | 2 项 | 导出 Postman、Markdown 离线导出（新前端仅 HTML/Word） | 等待后续迭代 |

完整对应关系见 [路线图 / 新前端覆盖范围](../roadmap/#react-ui-coverage)。

## 两个前端、两个 UI webjar

这一点最容易混淆，**先说清**：

| UI webjar | 打包的前端 | 对应 starter |
| --- | --- | --- |
| `knife4j-openapi2-ui` | 上游 Vue2 产物（功能完整） | `knife4j-openapi2-spring-boot-starter`、`knife4j-aggregation-spring-boot-starter` |
| `knife4j-openapi3-ui` | React 新前端（从 Preview 起集成） | `knife4j-openapi3-spring-boot-starter`、`knife4j-openapi3-jakarta-spring-boot-starter`、`knife4j-aggregation-jakarta-spring-boot-starter` |

所以：

- 用 **Springfox + OpenAPI2** 走 `openapi2-starter`，UI 仍是**熟悉的 Vue2 版本**，所有 upstream 功能都有。
- 用 **springdoc-openapi + OpenAPI3** 走 `openapi3-starter` 或 `openapi3-jakarta-starter`，UI 是 **新 React 版本**（覆盖见上表），不熟悉行为请同时参考 [FAQ](./faq)。

## 维护节奏

knife4j-next 从 `1.0.0` 起采用独立 [SemVer](https://semver.org/lang/zh-CN/) 版本号：

- **Patch**（`5.0.0-SNAPSHOT`、`1.0.2`）：安全修复、Bug 修复。
- **Minor**（`1.1.0`、`1.2.0`）：前端体验改动、新功能（向后兼容）。
- **Major**（`2.0.0`）：破坏性变更。
- 自治 agent 工作在 `.agent/` 下留痕，每个任务对应 `TASK-###`，PR 与分支一一对应。

## 下一步推荐路径

- 想立刻试用：[快速开始](./getting-started) + [Demo 预览](./demo)
- 已经在用 upstream：[迁移指引](./migration)
- 准备做网关聚合：[Gateway](./gateway)
- 想看完整配置项：[配置参考](../reference/configuration)
- 踩到坑了：[FAQ](./faq)
