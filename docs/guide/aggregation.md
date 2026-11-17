---
title: Aggregation 聚合
---

# Aggregation 聚合（knife4j-aggregation-*-starter）

`knife4j-aggregation-spring-boot-starter`（Boot 2 / javax）、`knife4j-aggregation-jakarta-spring-boot-starter`（Boot 3 / jakarta）和 `knife4j-aggregation-boot4-spring-boot-starter`（Boot 4 / springdoc 3.x）提供**独立的聚合应用**方案：

- 启动一个**专门用来聚合的 Servlet 应用**，读取若干下游服务的 OpenAPI 文档，合并成一套 `doc.html`。
- 支持 **5 种数据源**：本地文件（Disk）、HTTP 直连（Cloud）、Nacos、Eureka、腾讯北极星（Polaris）。
- 与 [Gateway starter](./gateway) 二选一：Gateway 聚合内嵌在 Gateway 进程中（WebFlux 或 Server Web MVC）；Aggregation 是独立 Servlet 应用。

## 何时选 aggregation 而不是 gateway

- 你的微服务**不经过** Spring Cloud Gateway（或 Gateway 用的是别的技术栈）。
- 你希望聚合应用**完全独立部署**，不参与业务流量。
- 你想**从本地静态文件**加载历史版本的 `swagger.json` 做对比。

## 依赖

Spring Boot 3（Jakarta）：

```xml
<dependency>
    <groupId>com.baizhukui</groupId>
    <artifactId>knife4j-aggregation-jakarta-spring-boot-starter</artifactId>
    <version>5.8.2</version>
</dependency>

<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
</dependency>
```

Spring Boot 2（javax）换成 `knife4j-aggregation-spring-boot-starter`。

Spring Boot 4 换成 `knife4j-aggregation-boot4-spring-boot-starter`：

```xml
<dependency>
    <groupId>com.baizhukui</groupId>
    <artifactId>knife4j-aggregation-boot4-spring-boot-starter</artifactId>
    <version>5.8.2</version>
</dependency>

<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
</dependency>
```

聚合服务 `Application` 类：

```java
@SpringBootApplication
public class AggregationApplication {
    public static void main(String[] args) {
        SpringApplication.run(AggregationApplication.class, args);
    }
}
```

启动后访问 `http://localhost:8080/doc.html`。

## 公共配置骨架

```yaml
knife4j:
  enable-aggregation: true  # 开启聚合总开关
  basic-auth:               # 可选：保护聚合 UI 的 Basic 认证
    enable: true
    username: admin
    password: ${KNIFE4J_AGGREGATION_PASSWORD:change-me}
```

然后根据数据源类型选择 **disk / cloud / nacos / eureka / polaris** 的一种（或多种混合）。

## 模式 1：Disk（本地文件）

从磁盘或 classpath 读取 OpenAPI JSON 文件，**不发请求**。

```yaml
knife4j:
  enable-aggregation: true
  disk:
    enable: true
    routes:
      - name: 用户服务
        location: classpath:swagger/user-service.json
        swagger-version: "3.0"
        debug-url: http://user-service:9001
        service-path: /user-service
        order: 1
      - name: 订单服务
        location: /data/swagger/order-service.json
        swagger-version: "2.0"
        debug-url: http://order-service:9002
        order: 2
```

字段含义：

| 字段 | 说明 |
| --- | --- |
| `name` | UI 中该分组的显示名称 |
| `location` | 本地文件路径或 classpath 路径 |
| `swagger-version` | `"2.0"` 或 `"3.0"`。OpenAPI 3.2 文档仍使用 `"3.0"`（相对 Swagger 2 的 OpenAPI 3 家族标签）；文档自身的 `openapi` 字段才是 `3.2.0`。见 [OpenAPI 3.2 支持矩阵](./openapi32)。 |
| `debug-url` | 在 UI 发起调试时请求真实落到的地址 |
| `service-path` | 有 Gateway 前置时追加的 basePath（避免 UI 展示路径与实际不一致） |
| `order` | 排序，越小越靠前 |

::: info 调试地址
当前 route 配置使用 `debug-url`，配置类没有 `host` 属性；旧配置应改为 `debug-url`。
:::

## 模式 2：Cloud（HTTP 直连）

Cloud 路由显式配置下游 HTTP 地址，不依赖 Spring Cloud Discovery。聚合应用代理浏览器对下游 `/v2/api-docs` 或 `/v3/api-docs` 的请求，后台心跳用于检查服务可达性：

```yaml
knife4j:
  enable-aggregation: true
  cloud:
    enable: true
    routes:
      - name: 用户服务
        uri: http://user-service:9001
        location: /v3/api-docs
        swagger-version: "3.0"
        order: 1
      - name: 订单服务
        uri: http://order-service:9002
        location: /v2/api-docs
        swagger-version: "2.0"
        order: 2
        route-auth:        # 下游 doc.html 被 Basic 保护时
          enable: true
          username: admin
          password: secret
```

这是最常用的模式，适合 K8s 集群内部网络。

## 模式 3：Nacos

<<< ../snippets/config/nacos.yml

聚合服务在启动和后续心跳中从 Nacos 查询实例，文档请求由聚合应用转发至实例。注意：

- `service-auth` 只影响 Nacos OpenAPI 的鉴权。
- 内部 token 有效期固定为 18000 秒，到期前会自动刷新（阈值 100s）；当前没有公开 setter，不能通过 `token-expire` 配置覆盖。

## 模式 4：Eureka

```yaml
knife4j:
  enable-aggregation: true
  eureka:
    enable: true
    service-url: http://eureka:8761/eureka
    # 若 Eureka Server 开启了 Basic
    service-auth:
      enable: false
    routes:
      - name: 用户服务
        service-name: USER-SERVICE
        location: /v3/api-docs
        swagger-version: "3.0"
        order: 1
```

Eureka 客户端以 `serviceName`（默认大写）匹配实例。

## 模式 5：Polaris（腾讯北极星）

<<< ../snippets/config/polaris.yml

聚合服务通过 HTTP OpenAPI 的 `/naming/v1/instances` 查询实例，不使用 gRPC SDK。当 `service-auth.enable=true` 时，启动检查要求用户名、密码非空，登录请求发送到 `/core/v1/user/login`。Polaris 服务端允许匿名查询时，可省略 `service-auth` 或设置 `service-auth.enable=false`，无需填写用户名、密码；此时不发起登录，未配置 `jwtCookie` 时也不发送 Cookie。若服务端仍要求认证，请启用认证并提供凭据；starter 不会自动检测或切换认证模式。地址配置支持 `service-url` 和 `serviceUrl` 两种写法。`namespace` 属于每条 route，服务名字段为 `service`。

## HTTP 连接参数调优

<<< ../snippets/config/connection.yml

这些参数影响 cloud / nacos / eureka / polaris 四种模式（disk 不走 HTTP）。当前配置类没有 `connection-request-timeout` 属性。

## 保护聚合 UI

```yaml
knife4j:
  basic-auth:
    enable: true
    username: admin
    password: ${KNIFE4J_AGGREGATION_PASSWORD:change-me}
```

聚合应用应该跑在**内部网络**或外挂 Nginx 层做额外防护。`basic-auth` 只是一道基础屏障。

## 验证

```bash
# 启动聚合应用
mvn spring-boot:run -f aggregation-app/pom.xml

# 访问聚合入口
curl -I http://localhost:8080/doc.html

# 查看聚合的分组列表（开发调试）
curl http://localhost:8080/swagger-resources
```

## 排错清单

| 现象 | 可能原因 |
| --- | --- |
| UI 显示 "加载资源失败" | 下游 `/v3/api-docs` 不通、聚合跨域、Basic 认证失败 |
| 分组列表为空 | `knife4j.enable-aggregation=true` 忘加；或 `*.enable=false` |
| `route-auth` 不生效 | `route-auth.enable=true` 是必须的，否则配置被忽略 |
| Nacos 模式拿不到实例 | `service-url` 是否带 `/nacos` 后缀；namespace 对不对；token 是否过期（重启服务） |
| 聚合后调试请求都打到聚合服务本身 | 配置 `service-path`（Gateway 场景）或确保 `debug-url` 指向下游 |

## 和 Gateway starter 如何二选一

| 对比项 | Gateway starter | Aggregation starter |
| --- | --- | --- |
| 运行形态 | 嵌入 Spring Cloud Gateway 进程 | 独立 Spring Boot 应用 |
| 技术栈 | WebFlux 或 Spring Cloud Gateway Server Web MVC | Servlet（spring-boot-starter-web） |
| 数据源 | 服务发现 / 手动路由 | Disk / Cloud / Nacos / Eureka / Polaris |
| 典型场景 | 已有 Gateway，顺带聚合 | 无 Gateway 或想独立部署聚合 |
| 是否支持本地 JSON | ❌ | ✅（Disk 模式） |
| 是否参与生产业务流量 | 是（Gateway 同进程） | 否 |

## 相关

- [Gateway 聚合](./gateway)：另一种形态。
- [配置参考 / knife4j aggregation](../reference/configuration#聚合-starter-配置)：全部 YAML 选项。
- [模块说明](../reference/modules)：`knife4j-aggregation-*-starter` 在仓库里的位置。
