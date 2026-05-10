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
| 当前版本 | `4.6.0` | `5.0.0` |
| 文档站 | [doc.xiaominfo.com](https://doc.xiaominfo.com/) | 本站（`knife4jnext.com`） |

**迁移的最小单位是改 `groupId`，业务代码、配置键、访问路径都不必动。** 详见 [迁移指引](./migration)。

## 这份 fork 想解决什么

1. **兼容性修复**。upstream 对 Spring Boot 3.4 / 3.5 的适配步伐变慢，fork 已经升级 `springdoc-openapi-jakarta` 到 `2.8.9`，并通过 smoke-tests 覆盖 Boot 2.7.18 的 OAS2/OAS3、Boot 3.4.x Jakarta 与 Boot 3.5.0 Jakarta 组合。
2. **安全修复**。修复了 `/v2/api-docs;xxx` 分号绕过 Basic 认证的漏洞（[#886](https://github.com/xiaoymin/knife4j/issues/886)），以及 gateway `context-path` 下聚合 host 少斜杠的问题（[#954](https://github.com/xiaoymin/knife4j/issues/954)）。
3. **可重复发布流程**。`.github/workflows/release.yml` 通过 Central Publishing Plugin 直接推送 Maven Central，不依赖人工临场操作。
4. **可试用的 Demo**。`knife4j-demo-openapi3`（Spring Boot 3.4 + OpenAPI 3 + React UI）和 `knife4j-demo-openapi2`（Spring Boot 2.7 + OpenAPI 2 + Vue 3 UI）两个示例工程都附带 Dockerfile，可分别本地运行或在线预览。

## 哪些是 **已经** 做了的

下表仅列 **`master` 已合并** 的工作，不是路线图承诺。

| 方向 | 已合并 | 对应资料 |
| --- | --- | --- |
| Boot 2.7.18 starter + UI webjar | ✅ | [快速开始](./getting-started) |
| Boot 3.4.0 / 3.5.0 兼容 | ✅ | smoke-tests 模块 `boot3-jakarta-app`、`boot35-jakarta-app` |
| /doc.html 分号绕过修复 | ✅ `#886` | [发布说明](../release-notes/) |
| Gateway context-path 修复 | ✅ `#954` | [Gateway 接入](./gateway) |
| React + Vite 新前端 webjar | ✅ | 在 `knife4j-openapi3-ui` 生效；`knife4j-openapi2-ui` 交由本仓库 `knife4j-vue3` 维护 |
| 设置面板（Authorize / GlobalParam / OfflineDoc） | ✅ | 新前端右上角入口 |
| `knife4j-demo-openapi3` / `knife4j-demo-openapi2` Docker 镜像 | ✅ | [Demo 预览](./demo) |
| `com.baizhukui` 坐标发布 | ✅ | Maven Central |

## 哪些是 **没有** 做或 **部分实现**，需要你知道

upstream 文档里列出的增强特性在本 fork 的实际实现状态，前端和后端存在差异：

| 情况 | 示例 | 建议 |
| --- | --- | --- |
| 服务端能力已覆盖 | `knife4j.enable`、`knife4j.production`、`knife4j.basic`、JSR303 透传 | 安心使用 |
| Springfox 专属增强在 OAS3 中不处理 | `@DynamicParameters`、`@DynamicResponseParameters`、`@ApiOperationSupport(ignoreParameters/includeParameters)` 等 | 迁到 OpenAPI3 时改用实体类或标准 OpenAPI 注解替代 |
| 后端实现，新 React 前端尚未自动读取 | `knife4j.setting.enable-debug=false`、`enable-search`、`enable-open-api`、`enable-version`、`enable-footer-custom`、`home-custom-path`、`swagger-model-name`、`enable-after-script` 等 | 依赖这些 UI 开关的用户暂时使用 openapi2 starter + 本仓库 Vue 3 UI |
| React UI 已补齐或重做 | OAuth2 四种 flow 基础鉴权、HTML/Word/Markdown/OpenAPI JSON 离线导出、`tags-sorter` / `operations-sorter`、`x-markdownFiles` 自定义文档 | 优先以本仓库文档和实际 demo 为准 |
| 仍未覆盖 | Postman 导出、afterScript 等 | 等待后续迭代 |

完整对应关系见 [路线图 / 新前端覆盖范围](../roadmap/#react-ui-coverage)。

## 两个前端、两个 UI webjar

这一点最容易混淆，**先说清**：

| UI webjar | 打包的前端 | 对应 starter |
| --- | --- | --- |
| `knife4j-openapi2-ui` | 本仓库 `knife4j-vue3` 构建产物（兼容维护，功能较完整） | `knife4j-openapi2-spring-boot-starter`、`knife4j-aggregation-spring-boot-starter` |
| `knife4j-openapi3-ui` | React 新前端（从 Preview 起集成，为主线） | `knife4j-openapi3-spring-boot-starter`、`knife4j-openapi3-jakarta-spring-boot-starter`、`knife4j-aggregation-jakarta-spring-boot-starter`、`knife4j-gateway-spring-boot-starter` |

所以：

- 用 **Springfox + OpenAPI2** 走 `openapi2-starter`，UI 是本仓库 `knife4j-vue3` 的构建产物（兼容维护），继续提供 upstream 已有功能。
- 用 **springdoc-openapi + OpenAPI3** 走 `openapi3-starter` 或 `openapi3-jakarta-starter`，UI 是 **新 React 版本**（覆盖见上表），不熟悉行为请同时参考 [FAQ](./faq)。

## 维护节奏

knife4j-next 从 `5.0.0` 起采用独立 [SemVer](https://semver.org/lang/zh-CN/) 版本号，与上游 knife4j 版本号无关：

- **Patch**（`5.0.1`、`5.0.2`）：安全修复、Bug 修复。
- **Minor**（`5.1.0`、`5.2.0`）：前端体验改动、新功能（向后兼容）。
- **Major**（`6.0.0`）：破坏性变更。

## 下一步推荐路径

- 想立刻试用：[快速开始](./getting-started) + [Demo 预览](./demo)
- 已经在用 upstream：[迁移指引](./migration)
- 准备做网关聚合：[Gateway](./gateway)
- 想看完整配置项：[配置参考](../reference/configuration)
- 踩到坑了：[FAQ](./faq)
