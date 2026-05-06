---
title: Gateway 聚合
---

# Gateway 聚合（knife4j-gateway-spring-boot-starter）

`knife4j-gateway-spring-boot-starter` 让 Spring Cloud Gateway 充当聚合入口：一次访问 `https://gateway/doc.html`，下面挂着所有下游微服务的 OpenAPI 分组。

它解决三件事：

1. 下游服务不用各自暴露 `doc.html`，开发期也能走统一域名访问。
2. Gateway 统一加 Basic 认证，保护文档。
3. 服务新增 / 下线不用改前端，通过服务发现自动刷新。

## 适用场景

- 项目使用 Spring Cloud Gateway（WebFlux 技术栈）。
- 下游服务已经用任一 knife4j starter 暴露 `/v2/api-docs` 或 `/v3/api-docs`。
- 需要在 Gateway 层面合并、排序、打分组。

::: info 和 knife4j-aggregation-*-starter 的区别
`knife4j-gateway-*-starter` 只跑在 Gateway 进程里（WebFlux）；`knife4j-aggregation-*-starter` 可以独立部署成聚合服务（Servlet）。二者不要在同一 Gateway 里同时启用。[Aggregation](./aggregation) 里有详细对比。
:::

## 最小依赖

Gateway 主工程 `pom.xml`：

```xml
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-gateway</artifactId>
</dependency>

<dependency>
    <groupId>com.baizhukui</groupId>
    <artifactId>knife4j-gateway-spring-boot-starter</artifactId>
    <version>5.0.0</version>
</dependency>
```

::: warning 不要把 knife4j 的 openapi starter 加到 Gateway
`knife4j-gateway-starter` 不是 UI 生成器，而是路由+聚合。Gateway 本身**不生成** OpenAPI 文档，只**汇聚**下游的。
:::

## 两种策略

Starter 通过 `knife4j.gateway.strategy` 切换：

| 策略 | 值 | 场景 |
| --- | --- | --- |
| 服务发现 | `DISCOVER` | 下游服务都注册到 Nacos/Eureka/Consul，自动聚合全部 |
| 手动路由 | `MANUAL`（默认） | 没接服务发现，或只想聚合一部分下游 |

## 策略 A：服务发现（DISCOVER）

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

- 修复版本：`1.0.0`（[#954](https://github.com/xiaoymin/knife4j/issues/954)）
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
| `doc.html` 打不开 | 确认 `knife4j.gateway.enabled: true`，以及 spring-cloud-starter-gateway 和 knife4j-gateway-starter 版本兼容 |
| UI 列出了服务但点进去 404 | 多半是 `context-path` 漏填；或 Gateway route 的 `StripPrefix` 与 `context-path` 不匹配 |
| 聚合路径命中 Gateway 路由规则 | 确保 `knife4j.gateway.discover.oas3.url` 指向的路径能被 Gateway 透传到下游 |
| 依然只看到一个服务 | 检查服务发现是否实际注册成功（`/actuator/gateway/routes`）；确认 `excluded-services` 没把目标服务排除掉 |
| 某些配置不生效 | knife4j gateway starter 跑在 WebFlux 栈，不要混用 spring-boot-starter-web（会冲突） |

## 相关

- [Aggregation starter](./aggregation)：如果你需要 **独立部署** 一个聚合服务，而不是跑在 Gateway 里。
- [配置参考 / knife4j.gateway](../reference/configuration#gateway)：全部 YAML 选项。
- [发布说明](../release-notes/)：gateway 相关的 changelog。

