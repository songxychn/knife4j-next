---
title: 快速开始
---

# 快速开始

本指南给出三条接入路径对应的最小可运行工程。每条路径都经过 `master` 的 `knife4j-smoke-tests` 模块回归验证。

::: tip 先决定走哪条路径
- **新项目、Spring Boot 3.x、不想踩 javax/jakarta 雷**：用 **OpenAPI3 Jakarta**，UI 是新 React 版本。
- **还在 Spring Boot 2.7.x**：可以继续用 OpenAPI2（Springfox），UI 是本仓库 `knife4j-vue3` 构建产物（兼容维护）；或 OpenAPI3（springdoc-openapi 非 Jakarta），UI 是 React 新前端。
- **已经在 upstream knife4j**：先看 [迁移指引](./migration)，只改 `groupId` 即可，不必换路径。

如果不确定哪个版本合适，先看 [版本参考表](../reference/version-ref)。
:::

## 路径一：Spring Boot 3.x + OpenAPI3 Jakarta（推荐）

### 环境要求

- JDK 17+
- Spring Boot `3.4.0` ~ `3.5.x`（smoke-tests 覆盖 `3.4.0` 与 `3.5.0`）
- springdoc-openapi-jakarta `2.8.9`（starter 已管理，无需显式声明）

### 依赖

```xml
<dependency>
    <groupId>com.baizhukui</groupId>
    <artifactId>knife4j-openapi3-jakarta-spring-boot-starter</artifactId>
    <version>5.0.0</version>
</dependency>
```

### 最小 `application.yml`

```yaml
springdoc:
  swagger-ui:
    path: /swagger-ui.html
    tags-sorter: alpha
    operations-sorter: alpha
  api-docs:
    path: /v3/api-docs
  group-configs:
    - group: default
      paths-to-match: /**
      packages-to-scan: com.example.demo

knife4j:
  enable: true
  setting:
    language: zh_cn
```

### 示例 Controller

```java
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/users")
@Tag(name = "用户管理", description = "用户相关接口")
public class UserController {

    @Operation(summary = "按 id 查询用户")
    @GetMapping("/{id}")
    public UserDto get(@PathVariable Long id) {
        return new UserDto(id, "alice");
    }

    @Operation(summary = "新增用户")
    @PostMapping
    public UserDto create(@RequestBody UserDto body) {
        return body;
    }
}
```

### 验证

1. `mvn spring-boot:run` 或运行 `knife4j-demo` 模块。
2. 浏览器打开 `http://localhost:8080/doc.html`，应看到 React 版界面。
3. `http://localhost:8080/v3/api-docs` 返回原始 OpenAPI JSON。

::: warning 新前端配置覆盖范围
React 新前端**不读取** `knife4j.setting.enable-debug`、`enable-search`、`enable-open-api`、`enable-version`、`enable-footer-custom`、`home-custom-path`、`swagger-model-name`、`enable-after-script` 等 UI 开关。
这些配置对 OpenAPI3 系列 starter + 新前端**暂不生效**。详见 [FAQ / 为什么我的 knife4j.setting 配置不生效](./faq#react-setting-not-effective) 与 [路线图 / 新前端覆盖范围](../roadmap/#react-ui-coverage)。
:::

---

## 路径二：Spring Boot 2.x + OpenAPI3（springdoc-openapi）

### 环境要求

- JDK 8 / 11 / 17
- Spring Boot `2.4.0` ~ `2.7.x`（建议 `2.7.18`）
- springdoc-openapi `1.8.0`（starter 已管理）

### 依赖

```xml
<dependency>
    <groupId>com.baizhukui</groupId>
    <artifactId>knife4j-openapi3-spring-boot-starter</artifactId>
    <version>5.0.0</version>
</dependency>
```

### 最小 `application.yml`

```yaml
springdoc:
  swagger-ui:
    path: /swagger-ui.html
  api-docs:
    path: /v3/api-docs

knife4j:
  enable: true
  setting:
    language: zh_cn
```

Controller 写法与 Jakarta 版一致，annotation 使用 `io.swagger.v3.oas.annotations`。

UI 同样是新 React 版本，注意覆盖范围提示。

---

## 路径三：Spring Boot 2.x + OpenAPI2（Springfox，Vue 3 UI）

::: info 何时选这条
- 项目深度依赖 Springfox 专属注解（`@ApiOperationSupport(ignoreParameters/includeParameters)`、`@DynamicParameters`、`@DynamicResponseParameters`）。
- 需要 upstream knife4j 文档上提到的完整 UI 能力（自定义 Footer/Home、OAuth2 调试、Postman 导出、版本小蓝点、afterScript）。
- 这些特性在本 fork 的新 React 前端中尚未覆盖，但在本仓库 `knife4j-vue3`（`knife4j-openapi2-ui` 打包产物）中完整保留。
:::

### 依赖

```xml
<dependency>
    <groupId>com.baizhukui</groupId>
    <artifactId>knife4j-openapi2-spring-boot-starter</artifactId>
    <version>5.0.0</version>
</dependency>
```

### 最小 `application.yml`

```yaml
knife4j:
  enable: true
  openapi:
    title: Knife4j 示例
    description: "`我是测试`"
    email: you@example.com
    concat: maintainer
    version: v1.0
    license: Apache 2.0
    group:
      default:
        group-name: 默认分组
        api-rule: package
        api-rule-resources:
          - com.example.demo
```

### 示例 Controller（Swagger 2 annotations）

```java
import io.swagger.annotations.*;
import org.springframework.web.bind.annotation.*;

@Api(tags = "用户管理")
@RestController
@RequestMapping("/api/users")
public class UserController {

    @ApiOperation("按 id 查询用户")
    @GetMapping("/{id}")
    public UserDto get(@ApiParam("用户 id") @PathVariable Long id) {
        return new UserDto(id, "alice");
    }
}
```

### 可选：启用 Docket 扩展体系

```java
@Configuration
@EnableSwagger2WebMvc
public class SwaggerConfig {

    private final OpenApiExtensionResolver openApiExtensionResolver;

    @Autowired
    public SwaggerConfig(OpenApiExtensionResolver openApiExtensionResolver) {
        this.openApiExtensionResolver = openApiExtensionResolver;
    }

    @Bean
    public Docket defaultApi() {
        String group = "默认分组";
        return new Docket(DocumentationType.SWAGGER_2)
                .groupName(group)
                .select()
                .apis(RequestHandlerSelectors.basePackage("com.example.demo"))
                .paths(PathSelectors.any())
                .build()
                .extensions(openApiExtensionResolver.buildExtensions(group));
    }
}
```

---

## 跑不起来？

1. `doc.html` 返回 404：确认 starter 在 classpath 里，且 `knife4j.enable=true`。若 context-path 非根，访问 `http://localhost:8080/<context-path>/doc.html`。
2. 看到 Swagger 原生 UI 而不是 Knife4j 界面：通常是引入了 `springfox-boot-starter` 或 `springdoc-openapi-ui` 的**非 jakarta** 版本与 jakarta starter 冲突。
3. `No OpenAPI resource found for group: swagger-config`：参考 [FAQ](./faq#no-openapi-resource-found)。
4. 生产环境想隐藏 doc.html：设置 `knife4j.production=true`，并视需要启用 `knife4j.basic`。

更多问题见 [FAQ](./faq)。

## 下一步

- 想看**完整可运行样例**：[Demo 预览](./demo)。
- 做**网关聚合**：[Gateway 接入](./gateway)。
- 做**多服务聚合**：[Aggregation](./aggregation)。
- 查**所有配置项**：[配置参考](../reference/configuration)。
