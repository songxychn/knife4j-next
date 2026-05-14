---
title: 从 Springfox 迁移到 OpenAPI3
---

# 从 Springfox（OpenAPI2）迁移到 OpenAPI3

本文针对正在使用 **Springfox + Swagger2 注解** 的项目，说明迁移到 **springdoc-openapi + OpenAPI3 注解** 的完整步骤。

::: info 为什么要迁移？
Springfox 自 `3.0.0`（2020 年）起已停止维护，存在大量兼容性问题（Spring Boot 2.6+ 就有 `PathMatchPolicy` 冲突）。OpenAPI3 是当前主流规范，springdoc-openapi 活跃维护，且 Knife4j 增强功能在 OpenAPI3 starter 中更完整。
:::

## 迁移路线图

```
当前状态                              目标状态
─────────────────────────────────    ─────────────────────────────────
springfox-swagger 2.x / 3.0.0   →   springdoc-openapi 2.x
knife4j-openapi2-spring-boot-starter  →  knife4j-openapi3-*-spring-boot-starter
Swagger2 注解 (@Api, @ApiOperation…)  →  OpenAPI3 注解 (@Tag, @Operation…)
/v2/api-docs                     →   /v3/api-docs
```

## 第一步：替换 Maven 依赖

### Spring Boot 2.x

```xml
<!-- 删除 -->
<dependency>
    <groupId>io.springfox</groupId>
    <artifactId>springfox-swagger2</artifactId>
</dependency>
<dependency>
    <groupId>io.springfox</groupId>
    <artifactId>springfox-swagger-ui</artifactId>
</dependency>
<!-- 如果用了旧版 knife4j，也删掉 -->
<dependency>
    <groupId>com.github.xiaoymin</groupId>
    <artifactId>knife4j-openapi2-spring-boot-starter</artifactId>
</dependency>

<!-- 替换为 -->
<dependency>
    <groupId>com.baizhukui</groupId>
    <artifactId>knife4j-openapi3-spring-boot-starter</artifactId>
    <version>5.0.3</version>
</dependency>
```

### Spring Boot 3.x（Jakarta）

```xml
<dependency>
    <groupId>com.baizhukui</groupId>
    <artifactId>knife4j-openapi3-jakarta-spring-boot-starter</artifactId>
    <version>5.0.3</version>
</dependency>
```

::: warning 不要混用
OpenAPI2 和 OpenAPI3 starter **不能同时引入**。确认 `pom.xml` 中只有其中一种。
:::

## 第二步：替换注解

| Swagger2 注解 | OpenAPI3 注解 | 说明 |
| --- | --- | --- |
| `@Api(tags = "用户")` | `@Tag(name = "用户")` | 类级别 |
| `@ApiOperation(value = "获取用户")` | `@Operation(summary = "获取用户")` | 方法级别 |
| `@ApiParam(value = "用户ID")` | `@Parameter(description = "用户ID")` | 参数级别 |
| `@ApiModel(value = "用户DTO")` | `@Schema(description = "用户DTO")` | 模型类级别 |
| `@ApiModelProperty(value = "用户名")` | `@Schema(description = "用户名")` | 字段级别 |
| `@ApiIgnore` | `@Hidden` | 忽略 |
| `@ApiImplicitParam` / `@ApiImplicitParams` | `@Parameter` | 隐式参数 |
| `@Authorization` / `@AuthorizationScope` | `@SecurityScheme` + `@SecurityRequirement` | 鉴权 |

### 注解替换示例

**Before（Swagger2）：**

```java
@Api(tags = "用户管理")
@RestController
@RequestMapping("/api/users")
public class UserController {

    @ApiOperation(value = "根据ID查询用户")
    @GetMapping("/{id}")
    public UserVO getById(
            @ApiParam(value = "用户ID", required = true)
            @PathVariable Long id) {
        return userService.getById(id);
    }

    @ApiOperation(value = "创建用户")
    @PostMapping
    public UserVO create(@RequestBody UserCreateDTO dto) {
        return userService.create(dto);
    }
}
```

```java
@ApiModel(value = "UserCreateDTO", description = "创建用户请求")
public class UserCreateDTO {

    @ApiModelProperty(value = "用户名", required = true, example = "alice")
    private String name;

    @ApiModelProperty(value = "年龄", example = "18")
    private Integer age;
}
```

**After（OpenAPI3）：**

```java
@Tag(name = "用户管理")
@RestController
@RequestMapping("/api/users")
public class UserController {

    @Operation(summary = "根据ID查询用户")
    @GetMapping("/{id}")
    public UserVO getById(
            @Parameter(description = "用户ID", required = true)
            @PathVariable Long id) {
        return userService.getById(id);
    }

    @Operation(summary = "创建用户")
    @PostMapping
    public UserVO create(@RequestBody UserCreateDTO dto) {
        return userService.create(dto);
    }
}
```

```java
@Schema(description = "创建用户请求")
public class UserCreateDTO {

    @Schema(description = "用户名", requiredMode = Schema.RequiredMode.REQUIRED, example = "alice")
    private String name;

    @Schema(description = "年龄", example = "18")
    private Integer age;
}
```

## 第三步：替换 YAML 配置

### 删除 Springfox 配置

删除所有 `Docket` Bean 配置：

```java
// 删除此类或其中的 @Bean public Docket docket()
```

### 添加 springdoc 配置

```yaml
springdoc:
  api-docs:
    path: /v3/api-docs           # OpenAPI JSON 端点
  swagger-ui:
    path: /swagger-ui.html       # Swagger UI（可选，Knife4j 用 doc.html）
  group-configs:
    - group: default
      paths-to-match: /**
      packages-to-scan: com.your.project.controller

knife4j:
  enable: true
```

::: tip 分组配置
如果你之前在 `Docket` 里配了多个分组（如 `user-api`、`order-api`），改为 springdoc 的 `group-configs`：

```yaml
springdoc:
  group-configs:
    - group: user-api
      packages-to-scan: com.your.project.user
    - group: order-api
      packages-to-scan: com.your.project.order
```
:::

## 第四步：处理不兼容的增强注解

以下 Knife4j 增强注解**仅在 openapi2 starter 中生效**，迁到 OpenAPI3 后需替换：

| 增强注解 | 状态 | 替代方案 |
| --- | --- | --- |
| `@DynamicParameters` | ❌ 不处理 | 改用实体类 + `@Schema` |
| `@DynamicResponseParameters` | ❌ 不处理 | 改用实体类 + `@Schema` |
| `@ApiOperationSupport(ignoreParameters)` | ❌ 不处理 | 使用 `@Schema(hidden = true)` 或 DTO 拆分 |
| `@ApiOperationSupport(includeParameters)` | ❌ 不处理 | 使用 DTO 拆分 |
| `@ApiOperationSupport(author)` | ✅ 仍生效 | — |
| `@ApiOperationSupport(order)` | ✅ 仍生效 | — |
| `@ApiSupport(author)` | ✅ 仍生效 | — |
| `@ApiSupport(order)` | ✅ 仍生效 | — |

### `@DynamicParameters` → 实体类

**Before：**

```java
@ApiOperationSupport(
    author = "张三",
    order = 1,
    params = {
        @DynamicParameters(name = "UserCreateDTO", properties = {
            @DynamicParameter(name = "name", value = "用户名", required = true, dataTypeClass = String.class),
            @DynamicParameter(name = "age", value = "年龄", dataTypeClass = Integer.class)
        })
    }
)
@PostMapping
public UserVO create(@RequestBody Object dto) {/* ... */}
```

**After：**

```java
@Operation(summary = "创建用户")
@PostMapping
public UserVO create(@RequestBody UserCreateDTO dto) {/* ... */}
```

```java
@Schema(description = "创建用户请求")
public class UserCreateDTO {
    @Schema(description = "用户名", requiredMode = Schema.RequiredMode.REQUIRED)
    private String name;

    @Schema(description = "年龄")
    private Integer age;
}
```

### `ignoreParameters` → DTO 拆分或 `@Schema(hidden)`

**Before：**

```java
@ApiOperationSupport(ignoreParameters = {"userVO.password"})
@GetMapping("/{id}")
public UserVO getById(@PathVariable Long id) {/* ... */}
```

**After — 方式一：DTO 拆分（推荐）：**

```java
// 查询响应不包含 password
@Schema(description = "用户查询响应")
public class UserQueryVO {
    @Schema(description = "用户ID")
    private Long id;
    @Schema(description = "用户名")
    private String name;
}
```

**After — 方式二：`@Schema(hidden)`：**

```java
@Schema(description = "用户响应")
public class UserVO {
    @Schema(description = "用户ID")
    private Long id;
    @Schema(description = "用户名")
    private String name;
    @Schema(description = "密码", hidden = true)
    private String password;
}
```

## 第五步：处理 Spring Security 放行

如果你使用 Spring Security，需要将文档相关路径放行：

### Springfox 时代的放行路径

```java
// 旧配置
http.authorizeRequests() //
    .antMatchers("/doc.html", "/webjars/**", //
        "/v2/api-docs", "/swagger-resources/**", "/swagger-ui.html") //
    .permitAll();
```

### OpenAPI3 时代的放行路径

```java
// 新配置
http.authorizeHttpRequests(auth -> auth //
        .requestMatchers(
            "/doc.html", //
            "/webjars/**", //
            "/v3/api-docs/**", //
            "/swagger-ui/**", //
            "/swagger-ui.html" //
        ).permitAll() //
);
```

::: tip 使用 Knife4j 的 production / basic 代替
Knife4j 提供了 `knife4j.production` 和 `knife4j.basic` 配置，可以在不修改 Security 规则的情况下控制文档访问。详见 [FAQ / 生产环境禁用](./faq#doc-html-404)。
:::

## 第六步：验证

```bash
# 1. 确认依赖
mvn dependency:tree -Dincludes=com.baizhukui:knife4j-*,io.springfox:*,org.springdoc:*

# 确认没有 springfox 残留，只有 springdoc-openapi

# 2. 启动验证
mvn spring-boot:run &

# 3. 检查 OpenAPI3 端点
curl http://localhost:8080/v3/api-docs | head

# 4. 浏览器访问
open http://localhost:8080/doc.html
```

## 常见问题

### Swagger2 注解还能用吗？

springdoc-openapi 对部分 Swagger2 注解（`@Api`、`@ApiOperation`）有**有限兼容**，但行为不可预测（如 `@Api` 的 `tags` 可能丢失），**建议全部替换为 OpenAPI3 注解**。

### Spring Boot 2.6+ 启动报 `PathMatchPolicy` 错误

这是 Springfox 的已知问题，迁到 springdoc-openapi 后自动解决。

### 接口排序不对

Springfox 的 `@Api(position = N)` 在 OpenAPI3 中不生效。改用 Knife4j 增强注解：

```java
@Tag(name = "用户管理")
@ApiSupport(order = 1)   // Knife4j 增强：控制 Tag 排序
@RestController
public class UserController {/* ... */}
```

或使用 springdoc 的 `@SortTag` / `@SortOperation`（springdoc 2.3.0+）。

### `springfox-swagger2` 和 `knife4j-openapi2` 能继续用吗？

可以，但请注意维护定位：

::: warning knife4j-openapi2-spring-boot-starter 处于维护模式
`knife4j-openapi2-spring-boot-starter` 目前处于**兼容维护模式**，不再接收新功能。具体影响：

- 底层 Springfox 停留在 `2.10.5`，不再更新。
- 前端是本仓库 `knife4j-vue3`（Vue 3 + Vite）的构建产物，打包进 `knife4j-openapi2-ui` webjar，只接收回归修复与显示层 bug；无法享受 `knife4j-ui-react` 的新特性。
- 新建的 UI 类 issue（SSE 流式响应、allOf/oneOf 渲染、二进制下载修复等）的修复**不会覆盖** OAS2 场景。

若需使用 `knife4j-ui-react` 的新特性（tags/operations 排序、OAuth2 popup、Markdown 渲染、设置持久化、copy endpoint/url 等），请迁移到 OAS3 starter：

```xml
<!-- Spring Boot 2.x -->
<dependency>
    <groupId>com.baizhukui</groupId>
    <artifactId>knife4j-openapi3-spring-boot-starter</artifactId>
    <version>5.0.3</version>
</dependency>

<!-- Spring Boot 3.x Jakarta -->
<dependency>
    <groupId>com.baizhukui</groupId>
    <artifactId>knife4j-openapi3-jakarta-spring-boot-starter</artifactId>
    <version>5.0.3</version>
</dependency>
```

如果你不想迁移注解，可以继续使用 OpenAPI2 starter——但建议新项目直接使用 OpenAPI3。
:::

## 相关

- [从 upstream 迁移](./migration)：改 Maven groupId 的迁移指引
- [注解速查表](../reference/annotations)：全部注解对照
- [配置参考](../reference/configuration)：YAML 配置完整参考
- [常见问题](./faq)：FAQ

