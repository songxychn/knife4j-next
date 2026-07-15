---
title: Gateway 聚合
---

# Gateway 聚合

Knife4j 支持两种 Spring Cloud Gateway 聚合实现：

- WebFlux Gateway：`knife4j-gateway-spring-boot-starter`（Boot 3.x）和 `knife4j-gateway-boot4-spring-boot-starter`（Boot 4.x）。
- Gateway Server Web MVC：`knife4j-gateway-webmvc-spring-boot-starter`（Boot 3.5 / Spring Cloud 2025.0.x）。

它们都让 Gateway 充当聚合入口：一次访问 `https://gateway/doc.html`，下面挂着所有下游微服务的 OpenAPI 分组。

它解决三件事：

1. 下游服务不用各自暴露 `doc.html`，开发期也能走统一域名访问。
2. Gateway 统一加 Basic 认证，保护文档。
3. 服务新增 / 下线不用改前端，通过服务发现自动刷新。

## 适用场景

- 项目使用 Spring Cloud Gateway；WebFlux 与 Server Web MVC 要引入各自对应的 starter。
- 下游服务已经用任一 knife4j starter 暴露 `/v2/api-docs` 或 `/v3/api-docs`。
- 需要在 Gateway 层面合并、排序、打分组。

::: info 和 knife4j-aggregation-*-starter 的区别
`knife4j-gateway-*-starter` 只跑在 Gateway 进程里（WebFlux 或 Server Web MVC）；`knife4j-aggregation-*-starter` 可以独立部署成聚合服务（Servlet）。二者不要在同一 Gateway 里同时启用。[Aggregation](./aggregation) 里有详细对比。
:::

## 最小依赖

### Spring Boot 3.x / Spring Cloud Gateway 4.x（WebFlux）

Gateway 主工程 `pom.xml`：

```xml
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-gateway</artifactId>
</dependency>

<dependency>
    <groupId>com.baizhukui</groupId>
    <artifactId>knife4j-gateway-spring-boot-starter</artifactId>
    <version>5.0.18</version>
</dependency>
```

### Spring Boot 4.x / Spring Cloud Gateway 5.x

Spring Cloud Gateway 5 使用新的 WebFlux starter 坐标：

```xml
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-gateway-server-webflux</artifactId>
</dependency>

<dependency>
    <groupId>com.baizhukui</groupId>
    <artifactId>knife4j-gateway-boot4-spring-boot-starter</artifactId>
    <version>5.0.18</version>
</dependency>
```

Boot 4.x 下 `knife4j.gateway.*` 配置保持不变；Spring Cloud Gateway 自身的 route / discovery 配置按 Gateway 5 文档使用。

### Spring Boot 3.5 / Spring Cloud Gateway Server Web MVC

Server Web MVC 使用 Servlet 技术栈，不能引入上面的 WebFlux Gateway starter：

```xml
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-gateway-server-webmvc</artifactId>
</dependency>

<dependency>
    <groupId>com.baizhukui</groupId>
    <artifactId>knife4j-gateway-webmvc-spring-boot-starter</artifactId>
    <version>5.0.18</version>
</dependency>
```

::: warning Server Web MVC 的 DISCOVER 有意限定为配置路由发现
它只聚合已经配置在 `spring.cloud.gateway.server.webmvc.routes` 中、同时满足 `uri: lb://<service>` 与 `Path` predicate 的路由。`DiscoveryClient` 仅用来确认服务仍在注册中心；它不会从注册中心自动创建 Gateway 路由，也不会读取运行时动态路由。
:::

::: warning 不要把 knife4j 的 openapi starter 加到 Gateway
`knife4j-gateway-starter` 不是 UI 生成器，而是路由+聚合。Gateway 本身**不生成** OpenAPI 文档，只**汇聚**下游的。
:::

## 两种策略

Starter 通过 `knife4j.gateway.strategy` 切换：

| 策略 | 值 | 场景 |
| --- | --- | --- |
| 服务发现 | `DISCOVER` | WebFlux 自动聚合注册服务；Server Web MVC 聚合已配置的 `lb://` 路由 |
| 手动路由 | `MANUAL`（默认） | 没接服务发现，或只想聚合一部分下游 |

## 策略 A：服务发现（DISCOVER）

下面示例适用于 WebFlux Gateway。Boot 4.x / Gateway 5.x 项目只需要把 `spring.cloud.gateway.*` 部分按 Gateway 5 迁移，`knife4j.gateway.*` 部分不变。

```yaml
server:
  port: 8080

spring:
  application:
    name: gateway-service
  cloud:
    gateway:
      discovery:
        locator:
          enabled: true      # Gateway 自动从注册中心生成路由
          lower-case-service-id: true

knife4j:
  gateway:
    enabled: true
    strategy: DISCOVER
    tags-sorter: alpha        # tag 排序，可选 alpha / order
    operations-sorter: alpha  # 接口排序，可选 alpha / method / order
    discover:
      enabled: true
      version: OpenAPI3       # 或 Swagger2
      excluded-services:      # 排除掉这些服务名（支持正则，v4.3.0+）
        - gateway-service
        - .*-config
      oas3:
        url: /v3/api-docs
      swagger2:
        url: /v2/api-docs
      service-config:         # 针对个别服务打覆盖
        user-service:
          group-name: 用户中心
          order: 1
          group-names:        # 该服务在 springdoc.group-configs 里定义了多个 group
            - users
            - roles
```

运行后：

1. 打开 `http://<gateway>/doc.html`。
2. 左上角分组下拉会出现 `user-service (users)` / `user-service (roles)` 等下游服务的分组。

### 关于 `excludedServices`

- 区分大小写由 `Set<String>` 和下游服务名决定。一般下游注册时用小写。
- `4.3.0+` 支持**正则表达式**，`".*-config"` 会排除所有 config 结尾的服务。

### `service-config` 的用法

当服务注册名（例如 `user-service`）不适合直接当 UI 上的 tab 名时，可以通过 `service-config.<serviceId>` 覆盖：

- `group-name`：UI 下拉里显示的名称。
- `order`：排序权重，越小越靠前。
- `group-names`：如果下游用 springdoc 的 `group-configs` 拆了多个 group，这里列出要聚合哪些 group。缺省只聚合 `default`。
- `context-path`：下游挂在非根路径（比如 `/api`），在此填写让聚合 UI 调用下游时路径正确。

### Server Web MVC 的配置路由 DISCOVER

Server Web MVC 没有 WebFlux Gateway 的动态 `DiscoveryClientRouteDefinitionLocator`。因此先把真实业务路由写进 Gateway，再让 Knife4j 从这些路由生成文档入口：

```yaml
spring:
  cloud:
    gateway:
      server:
        webmvc:
          routes:
            - id: user-service
              uri: lb://user-service
              predicates:
                - Path=/users/**

knife4j:
  gateway:
    enabled: true
    strategy: DISCOVER
    discover:
      version: OpenAPI3
      oas3:
        url: /v3/api-docs
```

上例会生成 `/users/v3/api-docs` 文档入口，调试接口的 `context-path` 也是 `/users`。要排除服务、改分组名、排序或为下游配置额外 group，继续使用上面的 `discover.excluded-services` 和 `discover.service-config`。没有 `lb://` + `Path` 的静态路由时，请改用 `MANUAL`。

## 策略 B：手动路由（MANUAL）

没有服务发现，或只想聚合一部分下游：

```yaml
server:
  port: 8080

spring:
  cloud:
    gateway:
      routes:
        - id: user-service
          uri: http://user-service:9001
          predicates:
            - Path=/user-service/**
          filters:
            - StripPrefix=1

knife4j:
  gateway:
    enabled: true
    strategy: MANUAL
    routes:
      - name: 用户中心
        service-name: user-service
        url: /user-service/v3/api-docs
        context-path: /user-service
        order: 1
      - name: 订单中心
        service-name: order-service
        url: /order-service/v3/api-docs
        context-path: /order-service
        order: 2
```

关键点：

- `url` 是 **聚合 Gateway** 去取下游文档的路径（Gateway 自身发一次请求）。
- `context-path` 是下游真实 context-path，**前端 UI 调试接口时会在请求 URL 前拼上这段**，避免落到 Gateway 根路径找不到。
- `order` 越小越靠前。

## 保护 Gateway 聚合入口

```yaml
knife4j:
  gateway:
    enabled: true
    basic:
      enable: true
      username: admin
      password: ${KNIFE4J_GATEWAY_PASSWORD:change-me}
```

此 Basic 只保护 Gateway 本身的 `/doc.html` + 聚合接口，**不会**把认证传到下游。

## OpenAPI3 聚合中 context-path 丢失的问题

历史 issue：下游应用设置了 `server.servlet.context-path=/api` 时，OpenAPI3 规范里不像 Swagger2 带 `basePath`，聚合到 Gateway 后调试请求会漏路径。

- 修复版本：`5.0.0` 起（Preview 线 `4.6.0.3` 已包含；[#954](https://github.com/xiaoymin/knife4j/issues/954)）
- 推荐手动声明：在 `service-config.<serviceId>.context-path`（DISCOVER）或 `routes[].context-path`（MANUAL）显式配置，最稳妥。

## 验证

```bash
# 1. 启动下游 user-service，验证 /v3/api-docs 返回 JSON
curl http://user-service:9001/v3/api-docs | head

# 2. 启动 gateway
# 3. 确认 gateway 能拉到下游文档（DISCOVER 模式路径就是 /v3/api-docs）
curl http://gateway:8080/v3/api-docs

# 4. 浏览器打开 gateway doc.html
open http://gateway:8080/doc.html

# 5. 手动触发聚合接口（Knife4j 用来发现服务的自定义接口）
curl http://gateway:8080/v3/api-docs/swagger-config
```

## 排错清单

| 现象 | 建议 |
| --- | --- |
| `doc.html` 打不开 | 确认 `knife4j.gateway.enabled: true`，以及 Spring Cloud Gateway starter 和 knife4j gateway starter 版本兼容 |
| UI 列出了服务但点进去 404 | 多半是 `context-path` 漏填；或 Gateway route 的 `StripPrefix` 与 `context-path` 不匹配 |
| 聚合路径命中 Gateway 路由规则 | 确保 `knife4j.gateway.discover.oas3.url` 指向的路径能被 Gateway 透传到下游 |
| Server Web MVC 的 DISCOVER 未列出服务 | 确认服务已注册，并且 `spring.cloud.gateway.server.webmvc.routes` 中有对应的 `lb://服务名` 和 `Path` predicate |
| 某些配置不生效 | 确认 starter 与 Gateway 实现匹配：WebFlux 用 `knife4j-gateway-*-starter`，Server Web MVC 用 `knife4j-gateway-webmvc-spring-boot-starter` |

## 相关

- [Aggregation starter](./aggregation)：如果你需要 **独立部署** 一个聚合服务，而不是跑在 Gateway 里。
- [配置参考 / knife4j.gateway](../reference/configuration#gateway)：全部 YAML 选项。
- [发布说明](../release-notes/)：gateway 相关的 changelog。
