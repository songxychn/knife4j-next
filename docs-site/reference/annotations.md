---
title: 注解速查表
---

# 注解速查表

本页列出 Knife4j 生态中所有相关注解，按来源分组，并标注 **通用** vs **Springfox 专有** vs **Knife4j 专有**。

> 迁移建议：如果你正在使用 OpenAPI 3 + springdoc，应优先使用 **通用** 栏的注解。Springfox 专有注解仅在 `knife4j-openapi2-spring-boot-starter` 场景下有效。

---

## 快速对照：Swagger 2 → OpenAPI 3 迁移映射

| Swagger 2（Springfox 专有） | OpenAPI 3（通用） | 说明 |
| --- | --- | --- |
| `@Api` | `@Tag` | 控制器分组 |
| `@ApiOperation` | `@Operation` | 接口说明 |
| `@ApiParam` | `@Parameter` | 参数说明 |
| `@ApiModel` | `@Schema` | 模型类说明 |
| `@ApiModelProperty` | `@Schema`（字段级） | 模型字段说明 |
| `@ApiImplicitParam` | `@Parameter` | 隐式参数 |
| `@ApiImplicitParams` | 多个 `@Parameter` | 多个隐式参数 |
| `@ApiResponse` / `@ApiResponses` | `@ApiResponse` / `@ApiResponses` | 响应说明（注意包名不同） |
| `@Authorization` / `@AuthorizationScope` | `@SecurityScheme` + `@SecurityRequirement` | 安全定义 |
| `springfox.documentation.annotations.ApiIgnore` | `@Hidden` 或 `@Operation(hidden = true)` | 忽略接口 |

---

## 一、OpenAPI 3 通用注解

> **包名**：`io.swagger.v3.oas.annotations.*`
> **依赖**：`io.swagger.core.v3:swagger-annotations`（springdoc 自动引入）
> **适用**：所有 OpenAPI 3 starter

### 1.1 接口与操作

| 注解 | 目标 | 常用属性 | 说明 |
| --- | --- | --- | --- |
| `@Tag` | 类 | `name`, `description` | 控制器分组，等价于 Swagger 2 的 `@Api` |
| `@Tags` | 类 | `value`（多个 `@Tag`） | 多分组声明 |
| `@Operation` | 方法 | `summary`, `description`, `deprecated`, `hidden`, `security`, `tags`, `operationId` | 接口说明，等价于 `@ApiOperation` |
| `@Hidden` | 类/方法/字段 | — | 标记整个接口或字段不在文档中展示 |

### 1.2 参数

| 注解 | 目标 | 常用属性 | 说明 |
| --- | --- | --- | --- |
| `@Parameter` | 方法参数 / 字段 | `name`, `description`, `required`, `example`, `deprecated`, `hidden`, `schema` | 参数说明，等价于 `@ApiParam` / `@ApiImplicitParam` |
| `@Parameters` | 方法 | `value`（多个 `@Parameter`） | 多参数声明 |

### 1.3 数据模型

| 注解 | 目标 | 常用属性 | 说明 |
| --- | --- | --- | --- |
| `@Schema` | 类 / 字段 / 方法参数 | `description`, `title`, `example`, `requiredMode`, `defaultValue`, `deprecated`, `hidden`, `nullable`, `allowableValues`, `implementation` | 统一的模型与字段说明，等价于 `@ApiModel` + `@ApiModelProperty` |
| `@ArraySchema` | 字段 | `schema`, `minItems`, `maxItems`, `uniqueItems` | 数组类型字段 |

### 1.4 响应

| 注解 | 目标 | 常用属性 | 说明 |
| --- | --- | --- | --- |
| `@ApiResponse` | 方法 | `responseCode`, `description`, `content`, `headers` | 单个响应说明 |
| `@ApiResponses` | 方法 | `value`（多个 `@ApiResponse`） | 多响应说明 |

### 1.5 安全

| 注解 | 目标 | 常用属性 | 说明 |
| --- | --- | --- | --- |
| `@SecurityScheme` | 类 | `name`, `type`, `scheme`, `bearerFormat`, `in`, `paramName` | 安全方案定义 |
| `@SecuritySchemes` | 类 | `value`（多个 `@SecurityScheme`） | 多安全方案 |

### 1.6 其他

| 注解 | 目标 | 常用属性 | 说明 |
| --- | --- | --- | --- |
| `@Server` | 类/方法 | `url`, `description` | 服务端点 |
| `@Servers` | 类/方法 | `value`（多个 `@Server`） | 多服务端点 |
| `@ExternalDocumentation` | 类/方法 | `url`, `description` | 外部文档链接 |
| `@Info` | 类（配合 `@OpenAPIDefinition`） | `title`, `version`, `description`, `termsOfService`, `contact`, `license` | API 基本信息 |
| `@Extension` / `@Extensions` | 多处 | `name`, `properties` | OpenAPI 扩展字段（`x-*`） |
| `@ExtensionProperty` | — | `name`, `value` | 扩展属性键值对 |

---

## 二、Swagger 2 / Springfox 专有注解

> **包名**：`io.swagger.annotations.*`
> **依赖**：`io.swagger:swagger-annotations`（Springfox 自动引入）
> **适用**：仅 `knife4j-openapi2-spring-boot-starter`
> **状态**：⛔ 如果你使用 OpenAPI 3 starter，这些注解**不生效**

| 注解 | 目标 | 常用属性 | OpenAPI 3 替代 |
| --- | --- | --- | --- |
| `@Api` | 类 | `value`, `tags`, `description`, `produces`, `consumes` | `@Tag` |
| `@ApiOperation` | 方法 | `value`, `notes`, `tags`, `produces`, `consumes`, `httpMethod` | `@Operation` |
| `@ApiParam` | 方法参数 | `value`, `required`, `defaultValue`, `allowableValues`, `hidden` | `@Parameter` |
| `@ApiModel` | 类 | `value`, `description` | `@Schema`（类级） |
| `@ApiModelProperty` | 字段 | `value`, `required`, `example`, `dataType`, `hidden`, `allowableValues` | `@Schema`（字段级） |
| `@ApiImplicitParam` | 方法 | `name`, `value`, `dataType`, `paramType`, `required`, `defaultValue` | `@Parameter` |
| `@ApiImplicitParams` | 方法 | `value`（多个 `@ApiImplicitParam`） | 多个 `@Parameter` |
| `@ApiResponse` | 方法 | `code`, `message`, `response` | `@ApiResponse`（注意包名不同） |
| `@ApiResponses` | 方法 | `value`（多个 `@ApiResponse`） | `@ApiResponses`（注意包名不同） |
| `@Authorization` | — | `value`, `scopes` | `@SecurityScheme` |
| `@AuthorizationScope` | — | `scope`, `description` | `@OAuthScope`（编程式） |
| `@Extension` | 多处 | `name`, `properties` | `@Extension`（v3） |
| `@ExtensionProperty` | — | `name`, `value` | `@ExtensionProperty`（v3） |
| `@Example` | — | `value` | `@ExampleObject`（v3） |
| `@ExampleProperty` | — | `value`, `mediaType` | `@ExampleObject`（v3） |

### Springfox 框架注解

| 注解 | 包名 | 说明 |
| --- | --- | --- |
| `@EnableSwagger2WebMvc` | `springfox.documentation.swagger2.annotations` | 启用 Springfox Swagger 2（仅 openapi2 starter） |
| `@ApiIgnore` | `springfox.documentation.annotations` | 忽略接口，OpenAPI 3 中用 `@Hidden` 替代 |

---

## 三、Knife4j 专有增强注解

> **包名**：`com.github.xiaoymin.knife4j.annotations.*`
> **依赖**：`knife4j-core`（所有 starter 自动引入）
> **前提**：需配合 `knife4j.enable=true` 使用（openapi2 starter 必须开启；openapi3 starter 建议开启）

### 3.1 `@ApiSupport` — 控制器增强

> **替代已废弃的 `@ApiSort`**（since 2.0.3）

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `order` | `int` | `Integer.MAX_VALUE` | Tag 排序值，数值越小越靠前 |
| `author` | `String` | `""` | 开发者（单值） |
| `authors` | `String[]` | `{}` | 开发者（多值，与 `author` 合并展示；since 4.2.0） |

**目标**：`ElementType.TYPE`（放在 Controller 类上）

```java
@Tag(name = "用户管理")
@ApiSupport(order = 1, author = "张三")
@RestController
public class UserController { ... }
```

> ⚠️ **React UI 注意**：`order` 排序在 React 前端暂不生效，`author`/`authors` 展示暂未实现。本仓库 `knife4j-vue3`（OAS2 starter）完整支持。

### 3.2 `@ApiOperationSupport` — 接口增强

> **替代已废弃的 `@ApiOperationSort`**（since 1.9.4）

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `order` | `int` | `0` | 操作排序值，同 Tag 下数值越小越靠前 |
| `author` | `String` | `""` | 开发者（单值） |
| `authors` | `String[]` | `{}` | 开发者（多值，与 `author` 合并展示；since 4.2.0） |
| `params` | `DynamicParameters` | `@DynamicParameters` | 动态请求参数（⚠️ 自 4.0 起放弃维护） |
| `responses` | `DynamicResponseParameters` | `@DynamicResponseParameters` | 动态响应参数（⚠️ 自 4.0 起放弃维护） |
| `ignoreParameters` | `String[]` | `{}` | 忽略参数名（⚠️ 自 4.0 起放弃维护） |
| `includeParameters` | `String[]` | `{}` | 包含参数名（⚠️ 自 4.0 起放弃维护） |

**目标**：`ElementType.METHOD`, `ElementType.ANNOTATION_TYPE`

```java
@Operation(summary = "创建用户")
@ApiOperationSupport(order = 1, author = "张三")
@PostMapping
public UserVO create(@RequestBody UserCreateRequest req) { ... }
```

**`ignoreParameters` 使用方式**：

```java
// 忽略实体类中的 id 字段
@ApiOperationSupport(ignoreParameters = {"id"})

// 忽略嵌套属性
@ApiOperationSupport(ignoreParameters = {"req.id", "req.inner.name"})

// 仅包含指定字段（与 ignoreParameters 对立）
@ApiOperationSupport(includeParameters = {"name", "email"})
```

> ⚠️ **React UI 注意**：`order` 排序在 React 前端暂不生效，`author`/`authors` 展示暂未实现。`ignoreParameters`/`includeParameters` 依赖后端 OpenAPI customizer 修改 schema，React 前端可以消费其结果。

### 3.3 `@DynamicParameter` / `@DynamicParameters` / `@DynamicResponseParameters` — 动态模型

> ⛔ **自 4.0 起放弃维护**，建议改用实体类 + `@Schema` 注解。保留定义仅用于向后兼容。

#### `@DynamicParameter`

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `name` | `String` | `""` | 属性名称 |
| `value` | `String` | `""` | 属性说明 |
| `required` | `boolean` | `false` | 是否必传 |
| `dataTypeClass` | `Class<?>` | `Void.class` | 属性类型 |
| `example` | `String` | `""` | 示例值 |

#### `@DynamicParameters`

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `name` | `String` | `""` | 动态 Model 名称 |
| `properties` | `DynamicParameter[]` | `@DynamicParameter` | 属性集合 |

#### `@DynamicResponseParameters`

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `name` | `String` | `""` | 动态响应 Model 名称 |
| `properties` | `DynamicParameter[]` | `@DynamicParameter` | 属性集合 |

**替代方案**（推荐）：

```java
// ❌ 旧写法（已放弃维护）
@ApiOperationSupport(
    params = @DynamicParameters(name = "CreateUserReq", properties = {
        @DynamicParameter(name = "name", value = "用户名", required = true),
        @DynamicParameter(name = "email", value = "邮箱")
    })
)

// ✅ 新写法（推荐）
@Schema(description = "创建用户请求")
public class UserCreateRequest {
    @Schema(description = "用户名", requiredMode = Schema.RequiredMode.REQUIRED)
    private String name;

    @Schema(description = "邮箱")
    private String email;
}
```

### 3.4 `@Ignore` — 忽略接口或参数

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `value` | `String` | `""` | 忽略原因说明 |

**目标**：`ElementType.METHOD`, `ElementType.TYPE`, `ElementType.PARAMETER`

```java
@Ignore("内部接口，不对外暴露")
@GetMapping("/internal")
public String internal() { ... }
```

> 💡 OpenAPI 3 标准方案是 `@Hidden`，Knife4j 的 `@Ignore` 是其增强版（可附带原因说明）。两者功能重叠，推荐优先使用 `@Hidden`。

### 3.5 `@EnableKnife4j` — 启用增强

> **包名**：`com.github.xiaoymin.knife4j.spring.annotations.EnableKnife4j`
> **目标**：`ElementType.TYPE`（放在 Spring Boot 启动类或配置类上）

```java
@EnableKnife4j
@SpringBootApplication
public class MyApplication { ... }
```

**等价配置**：在 `application.yml` 中设置 `knife4j.enable: true`，Spring Boot 自动配置会生效。`@EnableKnife4j` 主要用于显式声明或 openapi2 场景。

> ⚠️ 在 OpenAPI 3 + Spring Boot 3.x 场景下，`@EnableKnife4j` **不是必须的**——`knife4j.enable=true` 足矣。

---

## 四、springdoc 专用注解

> **包名**：`org.springdoc.core.annotations.*`
> **依赖**：`springdoc-openapi`（starter 自动引入）

| 注解 | 目标 | 说明 |
| --- | --- | --- |
| `@ParameterObject` | 方法参数 | 将一个 POJO 参数展开为多个 query 参数（而非整体作为一个 request body） |

```java
@GetMapping("/search")
public PageResult<UserVO> search(@ParameterObject PageQuery query) { ... }
// 等价于在 URL 上展开 query.pageNum、query.pageSize、query.keyword
```

---

## 五、已废弃注解

| 注解 | 废弃版本 | 替代方案 |
| --- | --- | --- |
| `@ApiSort` | 2.0.3 | `@ApiSupport(order = N)` |
| `@ApiOperationSort` | 1.9.4 | `@ApiOperationSupport(order = N)` |
| `@ApiIgnore`（Springfox） | — | `@Hidden`（OpenAPI 3） |
| `@EnableSwagger2WebMvc` | — | Springfox 本身已停止维护，迁移至 springdoc |

---

## 六、按场景速查

### 场景 1：OpenAPI 3 + Spring Boot 3.x（Jakarta）

**推荐注解组合**：

```java
@Tag(name = "用户管理")                     // 控制器分组
@ApiSupport(order = 1, author = "张三")     // Knife4j 增强：排序 + 作者
@RestController
public class UserController {

    @Operation(summary = "创建用户")         // 接口说明
    @ApiOperationSupport(order = 1)         // Knife4j 增强：排序
    @PostMapping
    public UserVO create(
        @RequestBody                        // 请求体
        @Schema(description = "创建用户请求")
        UserCreateRequest req
    ) { ... }

    @Operation(summary = "查询用户")         // 接口说明
    @GetMapping("/{id}")
    public UserVO get(
        @Parameter(description = "用户ID", example = "1")  // 路径参数
        @PathVariable Long id
    ) { ... }
}
```

### 场景 2：OpenAPI 3 + Spring Boot 2.x

注解用法与场景 1 完全相同，区别仅在于 Maven 依赖使用 `knife4j-openapi3-spring-boot-starter`（javax）而非 `knife4j-openapi3-jakarta-spring-boot-starter`（jakarta）。

### 场景 3：Swagger 2 / Springfox（旧项目）

**使用注解**：

```java
@Api(tags = "用户管理")                     // Swagger 2 分组
@ApiSort(1)                                // 已废弃，建议迁移
@RestController
public class UserController {

    @ApiOperation(value = "创建用户")        // Swagger 2 接口说明
    @PostMapping
    public UserVO create(@RequestBody UserCreateRequest req) { ... }
}
```

> 迁移路径参见 [迁移指南](/guide/migration)。

---

## 七、React UI 功能覆盖现状

Knife4j 专有注解的后端增强逻辑通过 `Knife4jOpenApiCustomizer` / `Knife4jOperationCustomizer` 修改 OpenAPI spec，React 前端理论上可以消费修改后的 spec。但以下增强在 **React 前端 UI 层面**暂未实现：

| 增强功能 | 后端是否生效 | Vue 3 UI（OAS2） | React UI（OAS3） | 说明 |
| --- | --- | --- | --- | --- |
| `@ApiSupport.order` Tag 排序 | ✅ 写入 spec | ✅ | ❌ | React 侧边栏暂不按 order 排序 |
| `@ApiSupport.author/authors` | ✅ 写入 spec | ✅ | ❌ | React 暂不展示开发者信息 |
| `@ApiOperationSupport.order` 操作排序 | ✅ 写入 spec | ✅ | ❌ | React 操作列表暂不按 order 排序 |
| `@ApiOperationSupport.author/authors` | ✅ 写入 spec | ✅ | ❌ | React 暂不展示开发者信息 |
| `ignoreParameters` / `includeParameters` | ✅ 修改 schema | ✅ | ⚠️ | 后端已修改 schema，React 能读到结果 |
| `@DynamicParameter` 系列 | ⚠️ 仅 openapi2 | ✅ | ❌ | 4.0 起放弃维护 |
| `@Ignore` | ✅ 过滤接口 | ✅ | ⚠️ | 后端过滤后 React 不展示被忽略接口 |

---

## 八、常见问题

### `@ApiSupport` 和 `@Tag` 的关系是什么？

`@Tag` 是 OpenAPI 3 标准注解，定义分组名称和描述。`@ApiSupport` 是 Knife4j 增强注解，提供排序和开发者信息——两者互补，不冲突：

```java
@Tag(name = "用户管理", description = "用户 CRUD 接口")  // 标准属性
@ApiSupport(order = 1, author = "张三")                   // Knife4j 增强
```

### `@Schema` 的 `requiredMode` vs `required`？

- `required = true`：Swagger 2 遗留写法，仍可用但已废弃。
- `requiredMode = Schema.RequiredMode.REQUIRED`：OpenAPI 3 推荐写法（since swagger-annotations 2.2）。

```java
// ✅ 推荐
@Schema(description = "用户名", requiredMode = Schema.RequiredMode.REQUIRED)
private String name;

// ⚠️ 遗留写法（仍可用）
@Schema(description = "用户名", required = true)
private String name;
```

### 为什么 `@ApiSupport.order` 不生效？

1. 确认 `knife4j.enable=true` 已配置。
2. 确认使用的是 WebMvc Starter（非 WebFlux，WebFlux 不支持后端增强）。
3. React 前端暂不支持按 `order` 排序，切换到本仓库 `knife4j-vue3`（OAS2 starter）验证。

### `@Ignore` vs `@Hidden` 用哪个？

功能重叠，推荐优先使用 OpenAPI 3 标准的 `@Hidden`。`@Ignore` 的额外好处是可附带忽略原因说明，但当前无 UI 消费此信息。

