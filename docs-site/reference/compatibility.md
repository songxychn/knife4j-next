---
title: 兼容矩阵
---

# 兼容矩阵

本页回答两个现实问题：

1. **我现在能不能迁过来？**
2. **迁过来之后我最该先验证什么？**

## 依赖基线

| 维度 | 版本 |
| --- | --- |
| knife4j-next | `5.0.1` |
| Java 最低版本 | `1.8`（openapi2 / openapi3 非 Jakarta）；`17`（Jakarta / Boot4） |
| Springfox | `2.10.5`（openapi2 starter） |
| springdoc-openapi | `1.8.0`（Boot 2.x）；`2.8.9`（Boot 3.x Jakarta）；`3.0.3`（Boot 4.x） |
| 前端 UI | React（openapi3 starter，打包 `knife4j-front/knife4j-ui-react`）；Vue 3（openapi2 starter，打包本仓库 `knife4j-vue3`） |

## Starter 兼容矩阵

以下矩阵基于 `knife4j-smoke-tests` 模块的自动化验证结果。✅ = smoke test 已通过；⚠️ = 依赖层面可用但无自动测试；❌ = 不兼容。

### WebMvc（Servlet）

| Starter | Boot 2.7 | Boot 3.4 | Boot 3.5 | Boot 4.0 | UI | 验证状态 |
| --- | --- | --- | --- | --- | --- | --- |
| `knife4j-openapi2-spring-boot-starter` | ✅ | ❌ | ❌ | ❌ | Vue 3 | [boot2-app](https://github.com/songxychn/knife4j-next/tree/master/knife4j/knife4j-smoke-tests/boot2-app) |
| `knife4j-openapi3-spring-boot-starter` | ✅ | ❌ | ❌ | ❌ | React | [boot2-openapi3-app](https://github.com/songxychn/knife4j-next/tree/master/knife4j/knife4j-smoke-tests/boot2-openapi3-app) |
| `knife4j-openapi3-jakarta-spring-boot-starter` | ❌ | ✅ | ✅ | ❌ | React | [boot3-jakarta-app](https://github.com/songxychn/knife4j-next/tree/master/knife4j/knife4j-smoke-tests/boot3-jakarta-app) / [boot35-jakarta-app](https://github.com/songxychn/knife4j-next/tree/master/knife4j/knife4j-smoke-tests/boot35-jakarta-app) |
| `knife4j-openapi3-boot4-spring-boot-starter` | ❌ | ❌ | ❌ | ✅ | React | [boot4-jakarta-app](https://github.com/songxychn/knife4j-next/tree/master/knife4j/knife4j-smoke-tests/boot4-jakarta-app) |

- openapi2 starter 依赖 Springfox，**不能在 Boot 3.x 上使用**。
- openapi3（非 Jakarta）starter 依赖 `springdoc-openapi 1.8.0`，**仅适用于 Boot 2.x**。
- openapi3 Jakarta starter 依赖 `springdoc-openapi 2.8.9`，**仅适用于 Boot 3.x**。
- openapi3 Boot4 starter 依赖 `springdoc-openapi 3.0.3`，**仅适用于 Boot 4.x WebMVC**。

### WebFlux

| Starter | Boot 2.7 | Boot 3.x | UI | 验证状态 |
| --- | --- | --- | --- | --- |
| `knife4j-openapi3-webflux-spring-boot-starter` | ⚠️ | ❌ | React | 无 smoke test |
| `knife4j-openapi3-webflux-jakarta-spring-boot-starter` | ❌ | ⚠️ | React | 无 smoke test |

- WebFlux starter 是**纯依赖编排**，不含后端增强能力（`@ApiOperationSupport`、`knife4j.setting.*` 等）。
- 详见 [WebFlux 接入](../guide/webflux)。

### Gateway & 聚合

| Starter | Boot 2.7 | Boot 3.x | 说明 | 验证状态 |
| --- | --- | --- | --- | --- |
| `knife4j-gateway-spring-boot-starter` | ❌ | ✅ | Spring Cloud Gateway 聚合 | ⚠️ 手动验证 |
| `knife4j-aggregation-spring-boot-starter` | ✅ | ❌ | 独立聚合（Boot 2.x） | ⚠️ 手动验证 |
| `knife4j-aggregation-jakarta-spring-boot-starter` | ❌ | ✅ | 独立聚合（Boot 3.x） | ⚠️ 手动验证 |

- Gateway starter 仅用于 Spring Cloud Gateway（WebFlux），**不适用于普通 WebMvc 项目**。
- 聚合 starter 用于**非网关**的微服务聚合场景。
- 详见 [Gateway 聚合](../guide/gateway) 和 [独立聚合](../guide/aggregation)。

## Smoke Tests 验证内容

每个 smoke-test 子模块验证以下端点返回 200 且内容正确：

| 端点 | openapi2 验证 | openapi3 验证 |
| --- | --- | --- |
| `GET /doc.html` | ✅ 包含 `webjars/js/` | ✅ 包含 `webjars/knife4j-ui-react/` |
| `GET /v2/api-docs` | ✅ 包含 `"swagger":"2.0"` | — |
| `GET /v3/api-docs` | — | ✅ 包含 `"openapi"` |
| `GET /knife4j/config` | — | ✅ 返回 `schemaVersion`、`apiDocsUrl`、`swaggerConfigUrl`，且不出现在 OpenAPI 文档中 |

运行全部 smoke test：

```bash
./scripts/test-java.sh
```

## 选型决策树

```
你的 Spring Boot 版本是？
├── 2.x
│   ├── 需要继续用 Swagger 2 / Springfox？
│   │   └── knife4j-openapi2-spring-boot-starter（Vue 3 UI）
│   └── 用 OpenAPI 3 / springdoc？
│       ├── WebMvc → knife4j-openapi3-spring-boot-starter（React UI）
│       └── WebFlux → knife4j-openapi3-webflux-spring-boot-starter（React UI）
├── 3.x
│   ├── WebMvc → knife4j-openapi3-jakarta-spring-boot-starter（React UI）
│   ├── WebFlux → knife4j-openapi3-webflux-jakarta-spring-boot-starter（React UI）
│   └── Spring Cloud Gateway？
│       └── knife4j-gateway-spring-boot-starter
└── 4.x
    └── WebMvc → knife4j-openapi3-boot4-spring-boot-starter（React UI）
```

## 不要做的事

- ❌ 不要在 Boot 3.x 上使用 openapi2 starter（Springfox 不兼容 Jakarta）。
- ❌ 不要同时引入 WebMvc 和 WebFlux 版 starter。
- ❌ 不要在 Boot 2.x 上使用 Jakarta 版 starter。
- ❌ 不要在 Boot 3.x 上使用非 Jakarta 版 starter（springdoc 1.x 不兼容）。
- ❌ 不要在 Boot 4.x 上使用 Boot 3.x Jakarta starter，请使用 Boot4 专用 starter。
- ❌ 不要把 Gateway starter 和 WebMvc/WebFlux starter 混用。
