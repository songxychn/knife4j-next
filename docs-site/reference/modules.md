---
title: 模块说明
---

# 模块说明

## 仓库顶层目录

| 目录 | 说明 |
| --- | --- |
| `knife4j/` | Java 主工程——用户实际引入的 starter 和 webjar 都在这里构建 |
| `knife4j-front/` | 下一代前端工作区（React UI + parser-core） |
| `knife4j-vue/` | 历史 Vue2 前端实现（upstream 旧版），仅作为"现有行为参考"留存，不再预期改动 |
| `knife4j-vue3/` | OAS2 兼容维护 UI，打包进 `knife4j-openapi2-ui` webjar，只接收回归修复与显示层 bug |
| `knife4j-insight/` | 独立渲染 / 聚合方向的扩展能力 |
| `knife4j-doc/` | 历史 Docusaurus 文档站（已废弃，内容迁移到 `docs-site/`） |
| `docs-site/` | 当前 VitePress 文档站 |

## Java 模块（`knife4j/` 下）

### 核心

| 模块 | 说明 | 用户是否直接引入 |
| --- | --- | --- |
| `knife4j-core` | 核心逻辑：过滤器、配置解析、vendor extension、OpenAPI 自定义器等 | 间接（starter 传递） |
| `knife4j-dependencies` | BOM（dependencyManagement），统一管理所有版本 | 间接（父 POM 继承） |

### UI（Webjar）

| 模块 | 说明 | 前端技术 |
| --- | --- | --- |
| `knife4j-openapi2-ui` | Swagger 2 专用 UI webjar，`doc.html` 入口；打包本仓库 `knife4j-vue3` 的 vite 构建产物 | Vue 3 |
| `knife4j-openapi3-ui` | OpenAPI 3 专用 UI webjar，`doc.html` 入口；打包 `knife4j-front/knife4j-ui-react` 的 vite 构建产物 | React |

### Starter（WebMvc）

| 模块 | 适用 Boot 版本 | 依赖的 springdoc | 依赖的 UI |
| --- | --- | --- | --- |
| `knife4j-openapi2-spring-boot-starter` | 2.x | —（用 Springfox） | `knife4j-openapi2-ui`（Vue 3） |
| `knife4j-openapi3-spring-boot-starter` | 2.x | `springdoc-openapi-ui 1.8.0` | `knife4j-openapi3-ui`（React） |
| `knife4j-openapi3-jakarta-spring-boot-starter` | 3.x | `springdoc-openapi-starter-webmvc-ui 2.8.9` | `knife4j-openapi3-ui`（React） |

### Starter（WebFlux）

| 模块 | 适用 Boot 版本 | 说明 |
| --- | --- | --- |
| `knife4j-openapi3-webflux-spring-boot-starter` | 2.x | 纯依赖编排，无后端增强 |
| `knife4j-openapi3-webflux-jakarta-spring-boot-starter` | 3.x | 纯依赖编排，无后端增强 |

### Starter（Gateway & 聚合）

| 模块 | 适用 Boot 版本 | 场景 |
| --- | --- | --- |
| `knife4j-gateway-spring-boot-starter` | 3.x | Spring Cloud Gateway 聚合 |
| `knife4j-aggregation-spring-boot-starter` | 2.x | 独立聚合（Disk/Cloud/Nacos/Eureka/Polaris） |
| `knife4j-aggregation-jakarta-spring-boot-starter` | 3.x | 独立聚合（Jakarta 版） |

### 其他

| 模块 | 说明 |
| --- | --- |
| `knife4j-demo` | OpenAPI 3 在线演示应用（Boot 3.4.5 + Jakarta starter + React UI，部署到 `openapi3.demo.knife4jnext.com`） |
| `knife4j-demo-openapi2` | OpenAPI 2 在线演示应用（Boot 2.7.18 + springfox 2.10.5 + Vue 3 UI，部署到 `openapi2.demo.knife4jnext.com`） |
| `knife4j-smoke-tests` | 自动化冒烟测试（4 个子模块覆盖 Boot 2.x / 3.x / 3.5.x） |

## 选型决策树

```
你的项目是什么？
│
├── 普通 Spring Boot WebMvc 应用
│   ├── Boot 2.x + 要用 Swagger 2 / Springfox
│   │   └── knife4j-openapi2-spring-boot-starter
│   ├── Boot 2.x + 要用 OpenAPI 3
│   │   └── knife4j-openapi3-spring-boot-starter
│   └── Boot 3.x
│       └── knife4j-openapi3-jakarta-spring-boot-starter
│
├── Spring Boot WebFlux 应用（非网关）
│   ├── Boot 2.x
│   │   └── knife4j-openapi3-webflux-spring-boot-starter
│   └── Boot 3.x
│       └── knife4j-openapi3-webflux-jakarta-spring-boot-starter
│
├── Spring Cloud Gateway 网关
│   └── knife4j-gateway-spring-boot-starter（Boot 3.x）
│
└── 非网关的微服务聚合
    ├── Boot 2.x
    │   └── knife4j-aggregation-spring-boot-starter
    └── Boot 3.x
        └── knife4j-aggregation-jakarta-spring-boot-starter
```

## 前端工作区（`knife4j-front/` 下）

| 模块 | 说明 |
| --- | --- |
| `knife4j-ui-react` | React 新前端，已集成进 `knife4j-openapi3-ui` webjar |
| `parser-core` | 前端 OpenAPI 解析核心库 |

## 注意事项

- **不要同时引入多个 starter**。WebMvc / WebFlux / Gateway / Aggregation 是互斥的，选一个即可。
- **openapi2 starter 不兼容 Boot 3.x**。它依赖 Springfox，Springfox 不支持 Jakarta。
- **WebFlux starter 不含后端增强**。`@ApiOperationSupport`、`knife4j.setting.*` 等能力仅 WebMvc starter 提供。详见 [WebFlux 接入](../guide/webflux)。
