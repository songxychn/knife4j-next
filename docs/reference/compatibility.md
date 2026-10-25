---
title: 兼容矩阵
---

# 兼容矩阵

本页回答两个现实问题：

1. **我现在能不能迁过来？**
2. **迁过来之后我最该先验证什么？**

## 依赖基线

::: warning Java 5.7.10 / Go v0.8.9 发布准备
Boot4 WebMVC、独立聚合、Gateway 及 Demo 的源码验证基线更新为 Boot `4.1.2`，
Cloud 保持 `2025.1.3`，springdoc 保持 `3.0.3`，Java 下限仍为 17。
Boot4 构建另外导入 Jackson 2 `2.22.4` / Jackson 3 `3.1.8` BOM，修复 `CVE-2026-110879`；
WebMVC 和独立聚合 starter 直接声明现有 Jackson 组件，以向没有自有 BOM 的消费方传递修复版本。
消费方的 `dependencyManagement` 仍可覆盖这些版本，接入时请按
[Jackson 依赖告警处理](../guide/faq#jackson-依赖告警处理) 检查最终依赖树。
以下表格描述待发布 `5.7.10`；最新已发布版本仍为 Java `5.7.9` / Go `v0.8.8`。发布准备不代表制品已经可用或线上已部署，也不承诺其他组件没有漏洞。
:::

| 维度 | 版本 |
| --- | --- |
| knife4j-next | `5.7.10` |
| Java 最低版本 | `1.8`（openapi2 / openapi3 非 Jakarta）；`17`（Jakarta / Boot4） |
| Springfox | `2.10.5`（openapi2 starter） |
| springdoc-openapi | `1.8.0`（Boot 2.x）；`2.9.1`（Boot 3.x Jakarta）；`3.0.3`（Boot 4.x） |
| 前端 UI | React（openapi3 starter，打包 `front/ui-react`）；Vue 3（openapi2 starter，打包本仓库 `front/vue3`） |

::: info 发布版本与源码能力
上表为待发布 `5.7.10` 的依赖基线；本轮 OpenAPI 3.1 能力从 Java `5.5.0` 起提供，
OpenAPI 3.2 消费从 Java `5.7.0` 起提供，
不应反向视为 `5.4.0` 等历史版本的能力。支持范围见 [OpenAPI 3.1 支持与迁移](../guide/openapi31)
和 [OpenAPI 3.2 支持与迁移](../guide/openapi32)。
当前 springdoc 仍生成 3.0.x / 3.1.x，不能把 `/v3/api-docs` 的版本字符串改成 3.2 冒充生成。
各版本变更以[发布说明](../release-notes/)为准。
:::

::: info 5.7.10 支持下限
Boot3 Jakarta MVC、WebFlux、独立聚合使用 springdoc `2.9.1` / Swagger Jakarta `2.2.55`。
Boot 3.4 线要求 `3.4.7+`，Boot 3.5 线要求 `3.5.1+`，对应 Framework `6.2.8`；
Boot `3.5.0` 不满足下限。Gateway 保持各自既有 Cloud/Boot 组合。Boot4 springdoc 保持 `3.0.3`，
Boot4 依赖为 Boot `4.1.2` / Cloud `2025.1.3`。
`5.7.7` 及更早版本历史记录不变，完整差异见[5.7.8 依赖更新](./version-ref#5-7-8-依赖更新)。
:::

## 浏览器基线

以下要求适用于 **Java `5.7.10` / Knife4x Go `v0.8.9`**，不反向修改历史发布版本的要求。

| UI | 5.7.8 / Go v0.8.7 基线 | 5.7.9 / Go v0.8.8 起沿用的最低浏览器 | 适用产物 |
| --- | --- | --- | --- |
| OAS3 React | 原构建目标：Chrome 87、Edge 88、Firefox 78、Safari 14 | Chrome / Edge **112**、Firefox **116**、Safari / iOS Safari **17** | OAS3 WebJar、Knife4x Go |
| OAS2 Vue3 | Chrome / Edge 111、Firefox 114、Safari 16.4 | Chrome / Edge **117**、Firefox **119**、Safari / iOS Safari **17.4** | OAS2 WebJar |

**两条 UI 的下限从 Java `5.7.9` / Go `v0.8.8` 起提高，本次补丁沿用。** OAS3 的 JSONPath 11 需要原生 `RegExp` 的 `v` 标志；OAS2 的 Mermaid 12 解析依赖需要原生 `Object.groupBy`。构建不会为旧浏览器补齐这些 API；升级前应确认用户实际浏览器版本，尤其是 Safari / iOS 系统版本。OAS3 旧构建目标仅作版本对照，不代表旧版所有运行时能力都在这些版本实测。

下限依据 [RegExp v 兼容数据](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/unicodeSets#browser_compatibility) 与 [Object.groupBy 兼容数据](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/groupBy#browser_compatibility) 制定，不代表最低版本或 Safari/Firefox 均已逐一实机验收。已合并变更的 Chromium 验证不能等同于全浏览器验收。

Vue3 及完整源码构建要求 Node `^24.15.0 || >=26.0.0`，不支持 Node 25；独立 OAS3 工具链及 Knife4x UI 同步仍要求 Node `22.13+` 或 `24+`。直接使用 Maven 发布包或 Go module 无需 Node。Java / Go 运行时基线保持不变。

## Starter 兼容矩阵

以下 starter 矩阵描述 `5.7.10`，Boot3 生成器线按上述下限接入；历史发布版本见[版本对照](./version-ref)。矩阵基于 `knife4j-smoke-tests` 模块的自动化验证结果。✅ = smoke test 已通过；⚠️ = 依赖层面可用但无自动测试；❌ = 不兼容。

### WebMvc（Servlet）

| Starter | Boot 2.7 | Boot 3.4 | Boot 3.5 | Boot 4.1 | UI | 验证状态 |
| --- | --- | --- | --- | --- | --- | --- |
| `knife4j-openapi2-spring-boot-starter` | ✅ | ❌ | ❌ | ❌ | Vue 3 | [boot2-app](https://github.com/songxychn/knife4j-next/tree/master/knife4j/knife4j-smoke-tests/boot2-app) |
| `knife4j-openapi3-spring-boot-starter` | ✅ | ❌ | ❌ | ❌ | React | [boot2-openapi3-app](https://github.com/songxychn/knife4j-next/tree/master/knife4j/knife4j-smoke-tests/boot2-openapi3-app) |
| `knife4j-openapi3-jakarta-spring-boot-starter` | ❌ | ✅ | ✅ | ❌ | React | [boot3-jakarta-app](https://github.com/songxychn/knife4j-next/tree/master/knife4j/knife4j-smoke-tests/boot3-jakarta-app) / [boot35-jakarta-app](https://github.com/songxychn/knife4j-next/tree/master/knife4j/knife4j-smoke-tests/boot35-jakarta-app) |
| `knife4j-openapi3-boot4-spring-boot-starter` | ❌ | ❌ | ❌ | ✅ | React | [boot4-jakarta-app](https://github.com/songxychn/knife4j-next/tree/master/knife4j/knife4j-smoke-tests/boot4-jakarta-app) |

- openapi2 starter 依赖 Springfox，**不能在 Boot 3.x 上使用**。
- openapi3（非 Jakarta）starter 依赖 `springdoc-openapi 1.8.0`，**仅适用于 Boot 2.x**。
- openapi3 Jakarta starter 依赖 `springdoc-openapi 2.9.1`，**仅适用于 Boot 3.x**。
- openapi3 Boot4 starter 依赖 `springdoc-openapi 3.0.3`，**仅适用于 Boot 4.x WebMVC**。

### WebFlux

| Starter | Boot 2.7 | Boot 3.x | UI | 验证状态 |
| --- | --- | --- | --- | --- |
| `knife4j-openapi3-webflux-spring-boot-starter` | ✅ | ❌ | React | [boot2-webflux-app](https://github.com/songxychn/knife4j-next/tree/master/knife4j/knife4j-smoke-tests/boot2-webflux-app) |
| `knife4j-openapi3-webflux-jakarta-spring-boot-starter` | ❌ | ✅ | React | [boot3-webflux-jakarta-app](https://github.com/songxychn/knife4j-next/tree/master/knife4j/knife4j-smoke-tests/boot3-webflux-jakarta-app) |

- WebFlux starter 是**纯依赖编排**，不含后端增强能力（`@ApiOperationSupport`、`knife4j.setting.*` 等）。
- 详见 [WebFlux 接入](../guide/webflux)。

### springdoc / OpenAPI 文档版本

| Spring Boot | springdoc | Web 栈 | 已验证 OpenAPI 输出 | 配置要求 |
| --- | --- | --- | --- | --- |
| Boot 2.x | `1.8.0` | WebMVC / WebFlux | 3.0.x | 保持 springdoc 1.x 输出，不支持生成 3.1 |
| Boot 3.4.7+ / 3.5.1+ | `2.9.1` | WebMVC / WebFlux | 3.1.x | 显式设置 `springdoc.api-docs.version=OPENAPI_3_1` |
| Boot 4.x | `3.0.3` | WebMVC | 3.1.x | 默认和显式 `OPENAPI_3_1` 均已验证 |

Boot 3 与 Boot 4 的 3.1 路径都经过真实 springdoc `/v3/api-docs`、Java smoke、React 与
SchemaEngine 验证；Boot 2 的 springdoc 1.8.0 继续输出 3.0 文档。配置、产品能力和迁移边界见
[OpenAPI 3.1 支持与迁移](../guide/openapi31)，端到端证据见
[#737](https://github.com/songxychn/knife4j-next/pull/737)。

当前生产 springdoc **不会**生成 OpenAPI 3.2。已发布的 3.2 消费使用标注来源的规范夹具，
由 React WebJar、starter 合成入口、聚合 disk 与 Knife4x SpecURL 承载；不能把 3.0/3.1 快照的
版本字符串改成 `3.2.0` 冒充真实 3.2 生成。详见 [OpenAPI 3.2 支持矩阵](../guide/openapi32)。

### Gateway & 聚合

| Starter | Boot 2.7 | Boot 3.x | Boot 4.1 | 说明 | 验证状态 |
| --- | --- | --- | --- | --- | --- |
| `knife4j-gateway-spring-boot-starter` | ❌ | ✅ | ❌ | Spring Cloud Gateway WebFlux 聚合 | [boot3-gateway-app](https://github.com/songxychn/knife4j-next/tree/master/knife4j/knife4j-smoke-tests/boot3-gateway-app) |
| `knife4j-gateway-webmvc-spring-boot-starter` | ❌ | ✅（3.5） | ❌ | Spring Cloud Gateway Server Web MVC 聚合；DISCOVER 仅读取已配置的 `lb://` + `Path` 路由 | [boot35-gateway-webmvc-app](https://github.com/songxychn/knife4j-next/tree/master/knife4j/knife4j-smoke-tests/boot35-gateway-webmvc-app) |
| `knife4j-gateway-boot4-spring-boot-starter` | ❌ | ❌ | ✅ | Spring Cloud Gateway 5 WebFlux 聚合 | [boot4-gateway-app](https://github.com/songxychn/knife4j-next/tree/master/knife4j/knife4j-smoke-tests/boot4-gateway-app) |
| `knife4j-aggregation-spring-boot-starter` | ✅ | ❌ | ❌ | 独立聚合（Boot 2.x） | [aggregation-boot2-app](https://github.com/songxychn/knife4j-next/tree/master/knife4j/knife4j-smoke-tests/aggregation-boot2-app) |
| `knife4j-aggregation-jakarta-spring-boot-starter` | ❌ | ✅ | ❌ | 独立聚合（Boot 3.x） | [boot3-aggregation-jakarta-app](https://github.com/songxychn/knife4j-next/tree/master/knife4j/knife4j-smoke-tests/boot3-aggregation-jakarta-app) |
| `knife4j-aggregation-boot4-spring-boot-starter` | ❌ | ❌ | ✅ | 独立聚合（Boot 4.x） | [boot4-aggregation-app](https://github.com/songxychn/knife4j-next/tree/master/knife4j/knife4j-smoke-tests/boot4-aggregation-app) |

- Gateway starter 仅用于 Spring Cloud Gateway：WebFlux 与 Server Web MVC 是不同实现，必须使用各自对应的 starter；它们都**不适用于普通 WebMvc 业务应用**。
- 聚合 starter 用于**非网关**的微服务聚合场景。
- 详见 [Gateway 聚合](../guide/gateway) 和 [独立聚合](../guide/aggregation)。

## Smoke Tests 验证内容

WebMvc smoke-test 子模块验证以下端点返回 200 且内容正确；WebFlux smoke-test 只验证 `/doc.html` 和 `/v3/api-docs`；Gateway 与独立聚合 smoke-test 额外验证 `/doc.html` 和 `/v3/api-docs/swagger-config`：

| 端点 | openapi2 验证 | openapi3 验证 |
| --- | --- | --- |
| `GET /doc.html` | ✅ 包含 `webjars/js/` | ✅ 包含 `webjars/knife4j-ui-react/` |
| `GET /v2/api-docs` | ✅ 包含 `"swagger":"2.0"` | — |
| `GET /v3/api-docs` | — | ✅ 包含 `"openapi"` |
| `GET /knife4j/config` | — | ✅ 返回 `schemaVersion`、`apiDocsUrl`、`swaggerConfigUrl`，且不出现在 OpenAPI 文档中 |

WebFlux starter 是纯依赖编排，不声明 `/knife4j/config` 等 WebMvc starter 增强入口。

运行全部 smoke test：

```bash
./tools/test-java.sh
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
│       ├── WebFlux → knife4j-gateway-spring-boot-starter
│       └── Server Web MVC（Boot 3.5）→ knife4j-gateway-webmvc-spring-boot-starter
└── 4.x
    ├── WebMvc → knife4j-openapi3-boot4-spring-boot-starter（React UI）
    ├── Spring Cloud Gateway WebFlux → knife4j-gateway-boot4-spring-boot-starter
    └── 非网关聚合 → knife4j-aggregation-boot4-spring-boot-starter
```

## 不要做的事

- ❌ 不要在 Boot 3.x 上使用 openapi2 starter（Springfox 不兼容 Jakarta）。
- ❌ 不要同时引入 WebMvc 和 WebFlux 版 starter。
- ❌ 不要在 Boot 2.x 上使用 Jakarta 版 starter。
- ❌ 不要在 Boot 3.x 上使用非 Jakarta 版 starter（springdoc 1.x 不兼容）。
- ❌ 不要在 Boot 4.x 上使用 Boot 3.x Jakarta starter，请使用 Boot4 专用 starter。
- ❌ 不要把 Gateway starter 和 WebMvc/WebFlux starter 混用。
