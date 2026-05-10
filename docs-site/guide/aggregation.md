---
title: Aggregation 聚合
---

# Aggregation 聚合（knife4j-aggregation-*-starter）

`knife4j-aggregation-spring-boot-starter`（Boot 2 / javax）和 `knife4j-aggregation-jakarta-spring-boot-starter`（Boot 3 / jakarta）提供**独立的聚合应用**方案：

- 启动一个**专门用来聚合的 Servlet 应用**，读取若干下游服务的 OpenAPI 文档，合并成一套 `doc.html`。
- 支持 **5 种数据源**：本地文件（Disk）、HTTP 直连（Cloud）、Nacos、Eureka、腾讯北极星（Polaris）。
- 与 [Gateway starter](./gateway) 二选一：Gateway 跑在 WebFlux 技术栈内嵌；Aggregation 是独立 Servlet 应用。

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
    <version>5.0.1</version>
</dependency>

<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
</dependency>
```

Spring Boot 2（javax）换成 `knife4j-aggregation-spring-boot-starter`。

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
| `swagger-version` | `"2.0"` 或 `"3.0"` |
| `debug-url` | 在 UI 发起调试时请求真实落到的地址 |
| `service-path` | 有 Gateway 前置时追加的 basePath（避免 UI 展示路径与实际不一致） |
| `order` | 排序，越小越靠前 |

::: info `host` 字段自 v4.0.0 废弃
`host` 已被 `debug-url` 替代。历史配置仍然可用（但以 `debug-url` 为准）。
:::

## 模式 2：Cloud（HTTP 直连）

聚合服务作为 HTTP 客户端，定时从下游拉 `/v2/api-docs` 或 `/v3/api-docs`：

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
        service-name: user-service
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

```yaml
knife4j:
  enable-aggregation: true
  nacos:
    enable: true
    service-url: http://nacos:8848/nacos
    # 若 Nacos 本身开启鉴权（参考 v2.0.9+）
    service-auth:
      enable: true
      username: nacos
      password: ${NACOS_PASSWORD}
    token-expire: 18000
    # 访问下游服务时使用的公共 Basic（仅用于 swagger 接口）
    route-auth:
      enable: false
    routes:
      - name: 用户服务
        service-name: user-service
        namespace: public
        group-name: DEFAULT_GROUP
        location: /v3/api-docs
        swagger-version: "3.0"
        service-path: /user-service
        order: 1
```

聚合服务在启动时从 Nacos 拿实例列表，定时从实例拉 API 文档。注意：

- `service-auth` 只影响 Nacos OpenAPI 的鉴权。
- 默认 `token-expire = 18000` 秒，到期前会自动刷新（阈值 100s）。

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

```yaml
knife4j:
  enable-aggregation: true
  polaris:
    enable: true
    server-addr: grpc://polaris-server:8091
    namespace: default
    routes:
      - name: 用户服务
        service-name: user-service
        location: /v3/api-docs
        swagger-version: "3.0"
        order: 1
```

Polaris 使用 gRPC 协议，聚合服务作为 Polaris SDK 客户端。

## HTTP 连接参数调优

```yaml
knife4j:
  connection-setting:
    socket-timeout: 60000       # 毫秒
    connect-timeout: 10000      # 毫秒
    connection-request-timeout: 10000
    max-total: 200              # 连接池总数
    default-max-per-route: 20   # 每个目标地址最多连接数
```

这些参数影响 cloud / nacos / eureka / polaris 四种模式（disk 不走 HTTP）。

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
| 技术栈 | WebFlux | Servlet（spring-boot-starter-web） |
| 数据源 | 服务发现 / 手动路由 | Disk / Cloud / Nacos / Eureka / Polaris |
| 典型场景 | 已有 Gateway，顺带聚合 | 无 Gateway 或想独立部署聚合 |
| 是否支持本地 JSON | ❌ | ✅（Disk 模式） |
| 是否参与生产业务流量 | 是（Gateway 同进程） | 否 |

## 相关

- [Gateway 聚合](./gateway)：另一种形态。
- [配置参考 / knife4j aggregation](../reference/configuration#aggregation)：全部 YAML 选项。
- [模块说明](../reference/modules)：`knife4j-aggregation-*-starter` 在仓库里的位置。

