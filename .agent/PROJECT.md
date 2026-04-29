# 项目意图

## 这个仓库是什么

`knife4j-next` 是 `xiaoymin/knife4j` 的社区维护 fork。

它存在的目的，是为仍依赖 `doc.html` 体验和相关 starter 模块的用户提供更可预期的维护路径。

## 当前优先级

1. 保持 `4.x` 对现有用户可用、稳定、可预期。
2. 修复 Spring Boot 2.7 / 3.x 与 Spring Framework 5.3 / 6.x 相关兼容性问题。
3. 降低聚合、UI 交付和 starter 行为中的回归风险。
4. 让发布流程更可重复，减少对人工临场操作的依赖。
5. 通过 `knife4j-front` 增量推进下一代前端，而不是一次性重写。

## 自治 Agent 的非目标

- 不要尝试完整产品重设计。
- 未经明确批准，不要替换当前 `doc.html` 兼容约定。
- 不要一次性迁移到 React。
- 不要为了代码优雅牺牲向后兼容。

## 前端分工策略（必读）

本仓库前端 UI 分为两条独立产物线，职责明确：

| 前端源码 | 产物 webjar | 对应 starter | OpenAPI 版本 | 维护策略 |
|---|---|---|---|---|
| `knife4j-front/knife4j-ui-react` (React + Vite) | `knife4j-openapi3-ui` | `knife4j-openapi3-spring-boot-starter`、`knife4j-openapi3-jakarta-spring-boot-starter`、`knife4j-gateway-spring-boot-starter`、`knife4j-aggregation-jakarta-spring-boot-starter` | **OpenAPI 3.x only** | **主线**：承接所有新功能、UX 改进、调试器增强 |
| `knife4j-vue3` (Vue 3 + Vite) | `knife4j-openapi2-ui` | `knife4j-openapi2-spring-boot-starter`、`knife4j-aggregation-spring-boot-starter` | **Swagger 2 / OAS 2 only** | **兼容维护**：只接收回归修复、安全补丁与显示层 bug；不做功能扩张 |

### 处理 upstream issue / 社区反馈的固定规则

1. **OAS3-only 场景** → 归入 `area:ui-react`，在 `knife4j-front/knife4j-ui-react` 修。
2. **OAS2-only / Swagger 2 注解相关** → 归入 `area:ui-vue3`，只在 `knife4j-vue3` 修显示与兼容性 bug。
3. **OAS2 + OAS3 都存在的共性 bug** → 优先在 OAS3 主线修；OAS2 侧仅做最小兼容修复或接受现状。
4. **OAS2 侧的新功能请求（sorter、OAuth2 弹窗授权、Markdown 新特性、导出等）** → 一律按 `wontfix: scope-policy` 关闭，并引导用户迁移到 OAS3 starter。
5. **`knife4j-core`（TypeScript 解析库）** 是 OAS3 主线的依赖，不为 OAS2 扩展。OAS2 语义由 `knife4j-vue3` 内部 `src/core/oas2` 自行处理。

### 不允许 Agent 自主推翻的边界

- 不允许把 OAS2 starter 切回 upstream Vue 2 webjar。
- 不允许让 `knife4j-vue3` 接入 OAS3 数据源。
- 不允许让 `knife4j-ui-react` 增加 OAS2 兼容层，除非维护者明确批准。
- 不允许在 `knife4j-openapi2-ui` 的 pom/plugin 里引入 React 产物。

触碰这些边界必须停下来找维护者确认。

### 关于 `knife4j-ui-react` 中已存在的 OAS2 类型字段

`knife4j-front/knife4j-ui-react/src/types/swagger.ts` 目前保留了若干 OAS2 字段：`definitions`、`securityDefinitions`、`host`、`basePath`、`schemes`、`in: 'body'` 等。少数渲染代码也为这些字段写了回退分支（例如 `Home.tsx` 的 servers 回退、`ApiDoc.tsx` 的 `$ref` 双正则）。

这些是 React UI 早期开发时遗留的**类型兼容**，**不构成对 OAS2 的功能承诺**：

- 入口层 `knife4jClient.fetchGroups()` 只请求 `v3/api-docs/swagger-config` 和 `swagger-resources`，不会主动拉 `v2/api-docs`；真实 springfox 后端从未在 React UI 上跑过端到端回归。
- 当前决议是**不主动清理也不主动扩展**这些字段：清理会触发连锁改动且无收益，扩展则属于上述硬约束禁止范围。
- 任何"顺手让 React 也支持一下 OAS2"的改动（新增数据源、补 `v2/api-docs` fallback、加 OAS2 专有解析逻辑等）都按 OAS2 兼容层处理，需维护者明确批准。

## 主要区域

### `knife4j`

Java 多模块主工程。这里是最关键的维护面，因为它影响下游用户使用的 starter 和 UI webjar。

### `knife4j-front/knife4j-core`

TypeScript 解析核心，服务于 `knife4j-ui-react`（OAS3 主线）。只要测试能证明行为，适合做窄范围自治任务。不为 OAS2 扩展。

### `knife4j-front/knife4j-ui-react`

**OAS3 主线 UI**。所有新功能、UX 改进、调试器增强都在这里落地。Agent 改动必须保持增量，不要隐含产品承诺。

### `knife4j-vue3`

**OAS2 兼容维护 UI**。只做回归修复、安全补丁、显示层 bug 修复，不做功能扩张。新功能请求一律指向 OAS3 迁移。

### `docs-site`

当前维护的文档站（VitePress）。适合自治清理、迁移说明和 release note 改进，前提是文档构建通过。

## 稳定性优先

当一个任务有多种解决方式时，优先选择：

1. 保留现有运行时行为
2. 增加测试覆盖或诊断能力
3. 回滚路径简单

## 状态纪律

重要状态不能只存在于 issue 评论、PR 评论或聊天记录里。Agent 必须把持久状态写回 `.agent/`。
