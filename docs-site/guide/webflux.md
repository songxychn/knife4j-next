---
title: WebFlux 接入
---

# WebFlux 接入（knife4j-openapi3-webflux-*-starter）

本 fork 提供两个 WebFlux 专用 starter：

| 模块 | 说明 | 依赖 |
| --- | --- | --- |
| `knife4j-openapi3-webflux-spring-boot-starter` | 非 Jakarta（适合 Spring Boot 2.x WebFlux） | `springdoc-openapi-webflux-ui` `1.8.0` |
| `knife4j-openapi3-webflux-jakarta-spring-boot-starter` | Jakarta（Spring Boot 3.x WebFlux） | `springdoc-openapi-starter-webflux-ui` `2.8.9` |

两者的作用都是：

1. 引入 springdoc 的 **WebFlux 版** swagger-ui 自动配置（而不是 webmvc 版）。
2. 把本仓库的 `knife4j-openapi3-ui` webjar（React 新前端）挂上去，以取代 springdoc 默认 Swagger UI。

## 和普通 WebMvc 版本的区别

```diff
- <artifactId>knife4j-openapi3-jakarta-spring-boot-starter</artifactId>
+ <artifactId>knife4j-openapi3-webflux-jakarta-spring-boot-starter</artifactId>
```

- WebMvc 版依赖 `springdoc-openapi-starter-webmvc-ui`。
- WebFlux 版依赖 `springdoc-openapi-starter-webflux-ui`。
- 两者**不能同时引入**，否则自动配置会冲突。

除此之外两个 starter 本身**不包含任何额外 Java 代码**（没有自定义 `OperationCustomizer`、`OpenApiCustomizer`、过滤器等）。所以：

::: warning WebFlux 下的 knife4j 增强能力
`knife4j-openapi3-webflux-*-starter` 仅完成**依赖编排**，不提供 `knife4j-openapi3-jakarta-spring-boot-starter` 那套基于 `Knife4jOpenApiCustomizer` / `Knife4jOperationCustomizer` 的能力：
- `@ApiOperationSupport(author/order)` 的 vendor extension 不会写入 `/v3/api-docs`
- `knife4j.documents`、`knife4j.production`、`knife4j.basic` 相关 Servlet 过滤器**不存在**
- i18n、自定义主页、自定义 Footer 等 `knife4j.setting.*` 的服务端注入缺失

如果需要以上能力，建议继续使用 WebMvc 技术栈，或等待 `knife4j-openapi3-webflux-*-starter` 后续补齐（已列入 [路线图](../roadmap/)）。
:::

## Boot 3.x（Jakarta）最小例

### 依赖

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-webflux</artifactId>
</dependency>

<dependency>
    <groupId>com.baizhukui</groupId>
    <artifactId>knife4j-openapi3-webflux-jakarta-spring-boot-starter</artifactId>
    <version>5.0.0-SNAPSHOT</version>
</dependency>
```

### `application.yml`

```yaml
springdoc:
  swagger-ui:
    path: /swagger-ui.html
    tags-sorter: alpha
    operations-sorter: alpha
  api-docs:
    path: /v3/api-docs
```

### 示例 Controller（Reactive）

```java
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Mono;

@RestController
@RequestMapping("/api/users")
@Tag(name = "用户管理")
public class UserController {

    @Operation(summary = "按 id 查询用户")
    @GetMapping("/{id}")
    public Mono<UserDto> get(@PathVariable Long id) {
        return Mono.just(new UserDto(id, "alice"));
    }
}
```

访问 `http://localhost:8080/doc.html` 即可。

## Boot 2.x（非 Jakarta）最小例

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-webflux</artifactId>
</dependency>

<dependency>
    <groupId>com.baizhukui</groupId>
    <artifactId>knife4j-openapi3-webflux-spring-boot-starter</artifactId>
    <version>5.0.0-SNAPSHOT</version>
</dependency>
```

## Spring Cloud Gateway 是 WebFlux 但**不**用这个 starter

Spring Cloud Gateway 基于 WebFlux，但它本身不生成 OpenAPI 文档——它**转发**请求。所以 Gateway 场景不用 `knife4j-openapi3-webflux-*-starter`，而用 `knife4j-gateway-spring-boot-starter`。

- 需要 **做 API 聚合** → [Gateway 聚合](./gateway)
- 需要 **生成** 自己的 API 文档 → 本页

## 替代方案

如果 `knife4j-openapi3-webflux-*-starter` 提供的能力不足（比如你想要 `@ApiOperationSupport` 的完整语义），可以：

1. **继续用 WebMvc**：把项目从 WebFlux 切回 Servlet，很多情况下这是最省事的选择。
2. **直接用 springdoc-openapi WebFlux starter** + 手写 knife4j 的 vendor extension，相当于自己实现一部分 `Knife4jOpenApiCustomizer` 的能力。

大部分团队用 WebFlux 的场景是 **网关 / 反应式微服务**，业务文档能力在 WebMvc 上就够用了。

## 验证

```bash
mvn spring-boot:run
curl -I http://localhost:8080/doc.html
curl http://localhost:8080/v3/api-docs | head
curl http://localhost:8080/v3/api-docs/swagger-config
```

返回 JSON 即正确。

## 排错

| 现象 | 建议 |
| --- | --- |
| 404 `/doc.html` | 是否错误地同时引入了 `knife4j-openapi3-jakarta-spring-boot-starter`（WebMvc 版）；WebFlux 环境下的静态资源路径需要 WebFlux 专用配置 |
| UI 是默认 Swagger UI 而不是 knife4j | 清 Maven 缓存；确认 `knife4j-openapi3-ui` 被 starter 传递依赖进来 |
| `Servlet` 相关的 ClassNotFoundException | 不要混入 `spring-boot-starter-web` |

