---
title: 功能
---

# 功能

Knife4j Next 围绕"文档更清晰、调试更顺手、聚合更简单、交付更完整"四个方向，提供面向 Spring 生态的 OpenAPI 文档增强能力。

## 核心功能

### API 文档浏览

- 提供更清晰的接口分组、参数说明和模型结构展示。
- 让大型项目里的接口更容易被查找、理解和复用。

### 在线接口调试

- 支持直接在文档页面内发起请求。
- 覆盖常见鉴权、全局参数和请求调试场景。

### 微服务文档聚合

- 面向 Spring Cloud Gateway 和多服务项目提供统一的文档入口。
- 适合按分组、按服务汇总 OpenAPI 文档。

### 离线文档导出

- 支持团队评审、归档和交付所需的离线文档能力。
- 方便将接口说明带出运行环境单独分发。

## 主要能力

- **接口分组与搜索**：让大型项目中的接口更容易查找、定位和理解。
- **请求参数增强**：支持全局参数、动态参数、参数缓存和请求过滤。
- **鉴权调试**：覆盖 Basic Auth、OAuth2 等常见接口调试场景。
- **模型展示增强**：更友好地展示请求体、响应体和嵌套模型结构。
- **网关聚合**：适合 Spring Cloud Gateway、多服务、多分组的文档统一展示。
- **离线交付**：支持将接口文档导出为离线格式，方便评审、归档和交付。
- **访问控制**：支持生产环境禁用、基础访问控制和文档入口保护。

## 适合哪些场景

如果你的团队已经在使用 Swagger、OpenAPI、Springfox 或 springdoc-openapi，但默认 UI 不够好用，Knife4j Next 可以作为更完整的文档增强层。

它保留熟悉的 `doc.html` 访问入口，同时提供更适合团队协作、联调和微服务聚合的功能。

---

## 功能详解

> 以下功能按**前端 UI 可用性**标注状态。✅ = React + Vue2 均可用；⚠️ = 仅 Vue2 可用（React 暂不支持）；❌ = 均暂不可用。

### 离线文档导出

| 导出格式 | Vue2 UI | React UI | 说明 |
| --- | --- | --- | --- |
| Markdown | ✅ | ✅ | 当前分组的完整 Markdown 文档 |
| HTML | ✅ | ✅ | 当前分组的 HTML 离线文档 |
| Word | ✅ | ✅ | 当前分组的 Word 文档 |
| OpenAPI JSON | ✅ | ✅ | 当前分组的原始 OpenAPI 规范 JSON |
| PDF | ❌ | ❌ | 暂未实现 |

在 UI 界面中进入**文档管理 → 离线文档**，选择格式后点击下载即可。

::: tip PDF 替代方案
目前可先导出 Markdown，再用 [Typora](https://typora.io/) 等工具转换 PDF。
:::

### OAuth2 调试

Knife4j UI 内置 OAuth2 授权调试面板（**Authorize**），支持四种模式：

| 模式 | Vue2 UI | React UI | 说明 |
| --- | --- | --- | --- |
| 授权码（authorization_code） | ✅ | ✅ | 最安全的模式，推荐 |
| 隐式（implicit） | ✅ | ✅ | 不推荐（OAuth2.1 已移除） |
| 密码（password） | ✅ | ⚠️ | 需要 username / password / clientId / clientSecret |
| 客户端凭证（client_credentials） | ✅ | ⚠️ | 需要 clientId / clientSecret |

::: warning OAuth2 回调地址
隐式模式和授权码模式需要配置回调地址。Knife4j 提供的回调页面位于 `webjars/oauth/oauth2.html`，因此服务端需将重定向 URI 配为 `http://<host>:<port>/webjars/oauth/oauth2.html`。
:::

#### OpenAPI3 配置示例（springdoc）

使用 `@SecurityScheme` 注解声明 OAuth2 配置：

```java
@SecurityScheme(
    name = "oauth2",
    type = SecuritySchemeType.OAUTH2,
    flows = @OAuthFlows(
        authorizationCode = @OAuthFlow(
            authorizationUrl = "http://localhost:8999/oauth/authorize",
            tokenUrl = "http://localhost:8080/oauth/token",
            scopes = {
                @OAuthScope(name = "read", description = "Read access"),
                @OAuthScope(name = "write", description = "Write access")
            }
        )
    )
)
@Tag(name = "用户管理")
@RestController
public class UserController { ... }
```

然后在需要鉴权的接口上添加 `@SecurityRequirement`：

```java
@Operation(summary = "删除用户")
@SecurityRequirement(name = "oauth2", scopes = {"write"})
@DeleteMapping("/{id}")
public void delete(@PathVariable Long id) { ... }
```

#### Swagger2 配置示例（Springfox）

在 `Docket` 中配置 `securitySchemes` 和 `securityContexts`，具体代码可参考 [upstream 文档](https://doc.xiaominfo.com/docs/features/oauth2)。

### 国际化（i18n）

Knife4j UI 支持中文（`zh-CN`）和英文（`en-US`）两种界面语言。

**方式一：UI 界面手动切换**

在 `doc.html` 右上角的语言选择器中直接切换。

**方式二：URL 参数直接指定**

- 中文：`http://host:port/doc.html#/home/zh-CN`
- 英文：`http://host:port/doc.html#/home/en-US`

**方式三：服务端 YAML 配置默认语言**

```yaml
knife4j:
  enable: true
  setting:
    language: zh-CN   # 或 en-US
```

::: warning React UI
React 新前端目前支持 i18n 切换，但 `knife4j.setting.language` 配置暂不生效（后端写入 OpenAPI extension 但前端不读取）。
:::

### 全局参数

Knife4j 提供 UI 端临时设置全局参数的功能，适用于后台全局 Token 等场景。支持两种参数类型：

- **query**（表单参数）
- **header**（请求头）

入口：**文档管理 → 全局参数设置**。

如果后端已经在 `Docket` 或 `@SecurityScheme` 中配置了全局参数，UI 全局参数可忽略。

### AfterScript（请求后脚本）

AfterScript 功能允许在每个接口调试 Tab 中编写一段 JavaScript 脚本，当接口调用成功后自动执行。最典型的场景是**登录后自动设置全局 Token**。

::: warning ⚠️ React UI 暂不支持
AfterScript 功能仅在 Vue2 UI（`knife4j-openapi2-spring-boot-starter`）中可用。React 新前端暂不支持。跟进进度见 [路线图](../roadmap/#react-ui-coverage)。
:::

#### 全局对象

Knife4j 提供 `ke`（Knife4j Environment）对象：

- `ke.global.setHeader(name, value)` — 设置当前分组全局 Header
- `ke.global.setAllHeader(name, value)` — 设置所有分组全局 Header
- `ke.global.setParameter(name, value)` — 设置当前分组全局 query 参数
- `ke.global.setAllParameter(name, value)` — 设置所有分组全局 query 参数
- `ke.response.headers` — 服务端响应 Header 对象（名称全小写）
- `ke.response.data` — 服务端响应数据

#### 示例：登录后自动设置全局 Token

```javascript
var code = ke.response.data.code;
if (code == 8200) {
    var token = ke.response.data.data.token;
    ke.global.setHeader("token", token);
}
```

### 自定义首页内容

开发者可以提供一个 Markdown 文件来自定义 `doc.html` 首页显示内容。

::: warning ⚠️ React UI 暂不支持
自定义首页仅在 Vue2 UI 中可用。React 新前端暂不支持。
:::

```yaml
knife4j:
  enable: true
  setting:
    enable-home-custom: true
    home-custom-path: classpath:markdown/home.md
```

> OpenAPI2 starter 还需在 `Docket` 中调用 `openApiExtensionResolver.buildSettingExtensions()`；OpenAPI3 系列 starter 无需此步骤。

### 自定义 Footer

```yaml
knife4j:
  enable: true
  setting:
    enable-footer: false          # 先禁用默认 Footer
    enable-footer-custom: true    # 启用自定义 Footer
    footer-custom-content: Apache License 2.0 | Copyright 2019-[Knife4j](https://github.com/songxychn/knife4j-next)
```

`footer-custom-content` 支持 Markdown 格式。

::: warning ⚠️ React UI 暂不支持
自定义 Footer 仅在 Vue2 UI 中可用。React 新前端暂不支持。
:::

### 自定义 Host

在某些网络环境下（如前后端分离部署、跨网段调试），可以通过 Host 配置指定调试请求的目标地址：

```yaml
knife4j:
  enable: true
  setting:
    enable-host: true
    enable-host-text: http://192.168.0.111:8080
```

Host 地址支持以下格式：
- `192.168.0.111:8080`（默认 HTTP）
- `http://192.168.0.111:8080` / `https://192.168.0.111:8080`
- `knife4j.example.com`（域名）
- `http://192.168.0.111:8080/v1`（带 basePath）

::: warning ⚠️ React UI 暂不支持
自定义 Host 仅在 Vue2 UI 中可用。React 新前端暂不支持。
:::

::: tip 前置条件：跨域
使用自定义 Host 时，后端必须启用 CORS。在 Spring Boot 中配置：
```yaml
knife4j:
  cors: true
```
或在 Gateway 层单独配置 CORS Filter。
:::

### 禁用调试 / 搜索 / OpenAPI

```yaml
knife4j:
  enable: true
  setting:
    enable-debug: false      # 禁用调试功能（调试 Tab 消失）
    enable-search: false     # 禁用搜索框
    enable-open-api: false   # 禁用 OpenAPI 原始结构 Tab
```

::: warning ⚠️ React UI 暂不支持
以上三项配置仅在 Vue2 UI 中生效。React 新前端暂不读取这些配置。
:::

### 请求参数缓存

Knife4j 默认会缓存调试时填写的请求参数（仅当后端未提供 `example` 时生效），方便下次调试时自动填充。

```yaml
knife4j:
  enable: true
  setting:
    enable-request-cache: true   # 默认 true，设为 false 可关闭缓存
```

- 后端 `@Schema(example = "张飞")` 提供了 example 的字段，**始终使用 example 值**，不使用缓存。
- 未提供 example 的字段，使用上次调试时填写的缓存值。

::: warning ⚠️ React UI 暂不支持
此配置仅在 Vue2 UI 中生效。React 新前端暂不读取。
:::

### 接口版本控制

Knife4j 使用浏览器 localStorage 识别接口变化：
- 后端**新增**接口时，UI 上显示 `new` 标记。
- 后端**修改**接口时（参数类型、说明等变化），UI 上显示变更标记。

判断依据：接口地址 + 请求类型（POST / GET / PUT ...）。

```yaml
knife4j:
  enable: true
  setting:
    enable-version: true    # 启用版本控制，默认 false
```

::: warning ⚠️ React UI 暂不支持
版本控制仅在 Vue2 UI 中可用。React 新前端暂不支持。
:::

### 清除缓存

Knife4j 的缓存存储在浏览器的 IndexedDB 中，**强制刷新页面无法清除**。如需清除缓存：

- 在 UI 右上角点击**清除缓存**按钮。
- 或在浏览器 DevTools → Application → IndexedDB 中手动删除。

### Spring Security 注解展示

Knife4j 会将 Spring Security 的 `@PreAuthorize`、`@PostAuthorize`、`@PreFilter`、`@PostFilter` 注解信息追加到接口描述中，方便开发者了解接口的权限要求：

```java
@RestController
@RequestMapping("/api/admin")
@PreAuthorize("hasAuthority('admin')")
public class AdminController {

    @GetMapping("/users")
    @PreAuthorize("hasAuthority('user:list')")
    @Operation(summary = "管理员查看用户列表")
    public List<UserVO> listUsers() { ... }
}
```

需要 `knife4j.enable=true` 开启增强模式。

### JSR303 校验注解透传

Knife4j 支持将 JSR303（Bean Validation）注解（如 `@NotNull`、`@Size`、`@Min`、`@Max` 等）自动透传到 OpenAPI Schema 的 `required`、`minLength`、`maxLength`、`minimum`、`maximum` 等属性中，让前端展示的参数校验规则与后端一致。

此功能在所有 starter 中均生效。

### 导出 Postman

Vue2 UI 中每个接口详情页有 **Open** 选项卡，展示当前接口的 OpenAPI 规范结构，可一键复制后导入 Postman。

::: warning ❌ React UI 暂不支持
导出 Postman 功能在 React 新前端中暂不可用。可替代方案：导出 OpenAPI JSON 后手动导入 Postman。
:::
