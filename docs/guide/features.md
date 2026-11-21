---
title: 功能
---

# 功能

Knife4j Next 面向 Spring 生态提供 OpenAPI 文档增强层，保留熟悉的 `doc.html` 入口，覆盖四类核心场景：

- **API 文档浏览**：接口分组、搜索、模型嵌套展示、自定义 Markdown 与自定义首页/Footer。
- **在线接口调试**：支持常见鉴权（Basic Auth / OAuth2）、全局参数、参数缓存与请求历史。
- **微服务文档聚合**：支持 Spring Cloud Gateway（WebFlux / Server Web MVC）与独立 Aggregation 服务聚合。
- **离线文档与访问控制**：支持 Markdown / HTML / Word / OpenAPI JSON 导出，以及生产禁用和 Basic 认证保护。

---

## 功能详解

> 以下功能按**前端 UI 可用性**标注状态。✅ = React + Vue3 均可用；🔲 = 部分实现；⬜ = 未实现；❌ = 均暂不可用。
>
> 这里的 Vue3 指本仓库 `front/vue3`，打包进 `knife4j-openapi2-ui` webjar，面向 OAS2 starter；React 指 `front/ui-react`，打包进 `knife4j-openapi3-ui` webjar，面向 OAS3 starter。Vue3 处于兼容维护状态，React 为主线。

### 离线文档导出

| 导出格式 | Vue3 UI | React UI | 说明 |
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

| 模式 | Vue3 UI | React UI | 说明 |
| --- | --- | --- | --- |
| 授权码（authorization_code） | ✅ | ✅ | 最安全的模式，推荐 |
| 隐式（implicit） | ✅ | ✅ | 不推荐（OAuth2.1 已移除） |
| 密码（password） | ✅ | ✅ | React 支持按 `tokenUrl` 直接换取 token |
| 客户端凭证（client_credentials） | ✅ | ✅ | React 支持按 `tokenUrl` 直接换取 token |

::: warning OAuth2 回调地址
隐式模式和授权码模式需要配置回调地址。React UI 的默认回调页为 `http://<host>:<port>/oauth2-redirect.html`；OAS2 Vue3 UI 继续使用 `http://<host>:<port>/webjars/oauth/oauth2.html`。
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

Knife4j UI 支持中文（`zh-CN`）、英文（`en-US`）和日语（`ja-JP`）三种界面语言。

**方式一：UI 界面手动切换**

在 `doc.html` 右上角的语言选择器中直接切换。

**方式二：URL 参数直接指定**

- 中文：`http://host:port/doc.html#/home/zh-CN`
- 英文：`http://host:port/doc.html#/home/en-US`
- 日语：`http://host:port/doc.html#/home/ja-JP`

**方式三：服务端 YAML 配置默认语言**

```yaml
knife4j:
  enable: true
  setting:
    language: zh_cn   # 可选 zh_cn / en / ja_jp（对应枚举 ZH_CN / EN / JA_JP）
```

::: warning React UI
React 新前端支持 i18n 切换，并会读取后端注入到 `x-openapi.x-setting.language` 的默认语言；用户在右上角语言菜单中的本地选择会覆盖后端默认值。
:::

### 全局参数

Knife4j 提供 UI 端全局参数设置，适用于统一透传 Token、租户头等调试场景，入口为 **文档管理 → 全局参数设置**。

- 支持 **header**、**query**（React UI 自 `5.2.0` 起还支持 **分组级隔离**、**Cookie 会话参数**、从响应体通过 **JSONPath 自动提取值** 以及敏感值掩码展示）。
- 如果后端已经在 `Docket` 或 `@SecurityScheme` 中配置了全局参数，UI 全局参数可按需省略。

### AfterScript（请求后脚本）

AfterScript 功能允许在每个接口调试 Tab 中编写一段 JavaScript 脚本，当接口调用成功后自动执行。最典型的场景是**登录后自动设置全局 Token**。

::: warning ⚠️ React UI 暂不支持
AfterScript 功能仅在 Vue3 UI（`knife4j-openapi2-spring-boot-starter` 打包的 `front/vue3`）中可用。React 新前端暂不支持。跟进进度见 [路线图](../roadmap/#react-ui-coverage)。
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

::: tip React UI 支持状态
React 新前端会在 `enable-home-custom=true` 且后端已经把 Markdown 内容注入到 `x-openapi.x-setting.homeCustomLocation` 时显示自定义首页。React 不读取 `home-custom-path` 文件路径，文件读取仍由后端 starter 完成。
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
    enable-footer: true           # 显示默认 Footer
    enable-footer-custom: true    # 启用自定义 Footer 文案
    footer-custom-content: Apache License 2.0 | Copyright 2019-[Knife4j](https://github.com/songxychn/knife4j-next)
```

`footer-custom-content` 支持 Markdown 格式。React 新前端会复用自身的 Markdown 安全清洗能力渲染该内容；当 `enable-footer-custom=true` 且内容非空时，自定义 Footer 优先展示，`enable-footer=false` 仅隐藏默认 Footer。

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

::: tip 调试器请求 baseUrl 优先级
React 新前端在发起接口调试时，按以下顺序解析请求 baseUrl：

1. **`setting.enable-host` / `enable-host-text`** —— 手动开启的 Host 覆盖（支持读取后端注入的 `enableHost` / `enableHostText` 默认值）。
2. **Gateway / 聚合分组 `contextPath`** —— 网关聚合场景下优先拼接分组声明的上下文路径，避免请求打到网关根路径。
3. **operation `servers[0].url`** —— 接口级 `servers` 覆盖地址。
4. **path item `servers[0].url`** —— 路径级 `servers` 覆盖地址。
5. **root `servers[0].url`** —— 文档根级 server URL（含 context-path；相对路径基于当前 UI origin 解析）。
6. **当前 UI origin** —— 兜底使用 `window.location.origin`。

当文档未显式声明协议且调试地址与当前页面同源时，React UI 会保留当前页面协议，避免 HTTPS 页面错误降级到 HTTP。OAS2 Vue3 UI 仅保留原有 Host 覆盖行为，不读取 `servers`。
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

::: warning React UI
以上三项配置在 Vue3 UI（OAS2 starter）中生效。React 新前端也会读取后端注入的默认值并隐藏对应入口，但这只是 UI 开关，不是安全控制。
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

::: tip React UI 支持状态
React 新前端已支持请求参数缓存，并读取后端注入的 `enable-request-cache` 默认值；用户在前端设置面板中的修改会覆盖后端默认值。
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
版本控制仅在 Vue3 UI（OAS2 starter）中可用。React 新前端暂不支持。
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

Vue3 UI（OAS2 starter）中每个接口详情页有 **Open** 选项卡，展示当前接口的 OpenAPI 规范结构，可一键复制后导入 Postman。

::: warning ❌ React UI 暂不支持
导出 Postman 功能在 React 新前端中暂不可用。可替代方案：导出 OpenAPI JSON 后手动导入 Postman。
:::
