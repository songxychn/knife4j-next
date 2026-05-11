---
title: 配置参考
---

# 配置参考

本页列出所有 `knife4j.*` YAML 配置属性，按使用场景分组。

> 属性源自 `@ConfigurationProperties` 类定义。部分 UI 配置在 React 前端暂不生效，已用 ⚠️ 标注。

## WebMvc Starter 通用配置

适用于 `knife4j-openapi2-spring-boot-starter`、`knife4j-openapi3-spring-boot-starter`、`knife4j-openapi3-jakarta-spring-boot-starter`、`knife4j-openapi3-boot4-spring-boot-starter`。

### `knife4j.*`

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `knife4j.enable` | `boolean` | `false` | 启用 Knife4j 后端增强。openapi2 必须设为 `true`；openapi3 使用 springdoc 默认路径时 UI 可不依赖它，但自定义 `springdoc.api-docs.path`、生产保护或其他 Knife4j 增强能力需要设为 `true` |
| `knife4j.cors` | `boolean` | `false` | 启用默认跨域支持 |
| `knife4j.production` | `boolean` | `false` | 生产环境：设为 `true` 后 `/doc.html`、`/v2/api-docs`、`/v3/api-docs`、`/knife4j/config` 等默认路径返回 JSON 错误响应（非 HTML 页面）。**注意**：当前仅保护默认路径；若自定义了 `springdoc.api-docs.path`，需要自行通过 `knife4j.basic.include` 追加规则或使用外层安全框架屏蔽 |
| `knife4j.openapi` | Object | — | OpenAPI 基本信息（仅 openapi2 starter，见下文） |
| `knife4j.basic` | Object | — | HTTP Basic 认证配置，见下文 |
| `knife4j.setting` | Object | — | UI 个性化配置，见下文 |
| `knife4j.documents` | List | — | 自定义 Markdown 文档分组，见下文 |
| `knife4j.insight` | Object | — | Knife4jInsight 配置，见下文 |

OpenAPI3 starter 会暴露 `/knife4j/config` 作为 Knife4j UI 的运行时发现入口。该接口不属于 springdoc 标准接口，由 UI 内部调用，并会从 OpenAPI 文档中隐藏，不展示在 `doc.html` 接口列表里。它用于在自定义 `springdoc.api-docs.path` 时返回实际的 `apiDocsUrl` 与 `swaggerConfigUrl`；响应通过 `schemaVersion` 标识契约版本，后续 Knife4j 运行时能力也应挂载在这个结构下。

::: warning 反向代理 / 网关放行
当应用部署在网关或反向代理之后时，请确保 `/knife4j/config`（与 `/doc.html`、`/v3/api-docs/**`、`/swagger-ui/**`、`/webjars/**` 一起）能透传到后端。常见情况：

- 仅显式放行 `/v3/api-docs/**` 与 `/swagger-ui/**` 的网关白名单需要补上 `/knife4j/config`，否则 React UI 在自定义 `springdoc.api-docs.path` 时无法发现实际 swagger-config 地址，落到 origin 兜底逻辑。
- 启用 `knife4j.basic` 时该路径会自动纳入 Basic 认证保护（已带分号绕过修复），不需要额外配置。
- 如果通过 `knife4j.production=true` 屏蔽默认入口，`/knife4j/config` 会一同返回 JSON 错误响应，是预期行为。
:::

### `knife4j.basic.*`

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `knife4j.basic.enable` | `boolean` | `false` | 启用 Basic 认证 |
| `knife4j.basic.username` | `String` | — | 用户名 |
| `knife4j.basic.password` | `String` | — | 密码 |
| `knife4j.basic.include` | `List<String>` | — | 需要认证的 URL（正则表达式，since 4.1.0） |

### `knife4j.setting.*`

| 属性 | 类型 | 默认值 | 说明 | React UI |
| --- | --- | --- | --- | --- |
| `knife4j.setting.language` | `ZH_CN` / `EN` | `ZH_CN` | 界面语言 | ✅ |
| `knife4j.setting.enableSwaggerModels` | `boolean` | `true` | 显示 Swagger Models 功能 | ✅ |
| `knife4j.setting.swaggerModelName` | `String` | `"Swagger Models"` | Swagger Models 名称 | ✅ |
| `knife4j.setting.enableDocumentManage` | `boolean` | `true` | 显示文档管理功能 | ⚠️ |
| `knife4j.setting.enableReloadCacheParameter` | `boolean` | `false` | 显示调试后刷新变量按钮 | ⚠️ |
| `knife4j.setting.enableAfterScript` | `boolean` | `true` | 显示 afterScript 功能 | ⚠️ |
| `knife4j.setting.enableVersion` | `boolean` | `false` | 启用接口版本控制 | ⚠️ |
| `knife4j.setting.enableRequestCache` | `boolean` | `true` | 启用请求参数缓存 | ⚠️ |
| `knife4j.setting.enableFilterMultipartApis` | `boolean` | `false` | 过滤 RequestMapping 多方法显示 | ⚠️ |
| `knife4j.setting.enableFilterMultipartApiMethodType` | `String` | `"POST"` | 过滤方法类型 | ⚠️ |
| `knife4j.setting.enableHost` | `boolean` | `false` | 启用 Host | ✅ |
| `knife4j.setting.enableHostText` | `String` | `""` | Host 地址 | ✅ |
| `knife4j.setting.enableDynamicParameter` | `boolean` | `false` | 启用动态请求参数 | ⚠️ |
| `knife4j.setting.enableDebug` | `boolean` | `true` | 启用调试功能 | ✅ |
| `knife4j.setting.enableFooter` | `boolean` | `true` | 显示底部 Footer | ✅ |
| `knife4j.setting.enableFooterCustom` | `boolean` | `false` | 自定义 Footer | ⚠️ |
| `knife4j.setting.footerCustomContent` | `String` | — | 自定义 Footer 内容（支持 Markdown） | ⚠️ |
| `knife4j.setting.enableSearch` | `boolean` | `true` | 显示搜索框 | ✅ |
| `knife4j.setting.enableOpenApi` | `boolean` | `true` | 显示 OpenAPI 原始结构 Tab | ✅ |
| `knife4j.setting.enableHomeCustom` | `boolean` | `false` | 启用首页自定义 | ⚠️ |
| `knife4j.setting.homeCustomLocation` | `String` | — | 首页自定义 Markdown 文件路径 | ⚠️ |
| `knife4j.setting.enableGroup` | `boolean` | `true` | 显示分组下拉框 | ✅ |
| `knife4j.setting.enableResponseCode` | `boolean` | `true` | 显示响应状态码栏 | ⚠️ |
| `knife4j.setting.customCode` | `Integer` | `200` | 生产环境屏蔽时的自定义 HTTP 状态码 | ✅ |

> React 新前端会读取后端注入到 OpenAPI JSON 的 `x-openapi.x-setting`，但只消费表中标 ✅ 的 UI 字段；用户在前端设置面板中的本地选择会覆盖后端默认值。标 ⚠️ 的配置仍会由后端写入 extension，但 React 暂不消费。详见 [FAQ](../guide/faq#react-setting-not-effective)。

> 各配置项的功能说明和示例见 [功能详解](../guide/features#功能详解)。

### `knife4j.documents`（列表）

```yaml
knife4j:
  documents:
    - group: 2.X版本
      name: 测试文档
      locations: classpath:markdown/*
```

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `group` | `String` | 所属分组 |
| `name` | `String` | 文档名称 |
| `locations` | `String` | Markdown 文件路径（classpath 前缀） |

### `knife4j.insight.*`（since 4.4.0）

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `knife4j.insight.enable` | `boolean` | `false` | 启用 Knife4jInsight 自动上传 |
| `knife4j.insight.server` | `String` | — | Insight 数据源地址（如 `http://console.knife4j.net`） |
| `knife4j.insight.secret` | `String` | — | 上传凭证密钥 |
| `knife4j.insight.namespace` | `String` | — | 上传命名空间（默认从应用名生成） |
| `knife4j.insight.serviceName` | `String` | — | 上传服务名（默认取 `spring.application.name`） |

### `knife4j.openapi.*`（仅 openapi2 starter）

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `knife4j.openapi.title` | `String` | — | 文档标题 |
| `knife4j.openapi.description` | `String` | — | 描述 |
| `knife4j.openapi.version` | `String` | — | 版本号 |
| `knife4j.openapi.email` | `String` | — | 联系邮箱 |
| `knife4j.openapi.url` | `String` | — | 主页 URL |
| `knife4j.openapi.concat` | `String` | — | 联系人 |
| `knife4j.openapi.termsOfServiceUrl` | `String` | — | 服务条款 URL |
| `knife4j.openapi.license` | `String` | — | 许可证 |
| `knife4j.openapi.licenseUrl` | `String` | — | 许可证 URL |
| `knife4j.openapi.group` | `Map` | — | 分组配置（key 为分组名） |

`knife4j.openapi.group.<name>.*`

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `groupName` | `String` | 分组名称 |
| `apiRule` | `PACKAGE` / `ANNOTATION` | API 扫描策略 |
| `apiRuleResources` | `List<String>` | 策略对应资源（包名或注解类名） |
| `pathRule` | `ANT` / `REGEX` | 路径匹配策略 |
| `pathRuleResources` | `List<String>` | 路径资源 |

---

## Gateway Starter 配置

适用于 `knife4j-gateway-spring-boot-starter`。

### `knife4j.gateway.*`

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `knife4j.gateway.enabled` | `boolean` | `false` | 启用 Gateway 聚合 |
| `knife4j.gateway.strategy` | `MANUAL` / `DISCOVER` | `MANUAL` | 聚合策略 |
| `knife4j.gateway.tagsSorter` | `alpha` / `order` | `alpha` | Tag 排序规则 |
| `knife4j.gateway.operationsSorter` | `alpha` / `order` | `alpha` | Operation 排序规则 |
| `knife4j.gateway.basic` | Object | — | Basic 认证（同 `knife4j.basic`） |
| `knife4j.gateway.discover` | Object | — | 服务发现配置 |
| `knife4j.gateway.routes` | List | — | 手动路由配置 |

### `knife4j.gateway.discover.*`

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enabled` | `Boolean` | `FALSE` | 启用服务发现 |
| `excludedServices` | `Set<String>` | — | 排除的服务名（支持正则，since 4.3.0） |
| `version` | `OpenAPI3` / `Swagger2` | `OpenAPI3` | 规范版本 |

### `knife4j.gateway.routes[]`

```yaml
knife4j:
  gateway:
    enabled: true
    routes:
      - name: 用户服务
        serviceName: user-service
        url: /v3/api-docs
        contextPath: /
        order: 1
```

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `name` | `String` | — | 分组名称（UI 显示） |
| `serviceName` | `String` | — | 服务名 |
| `url` | `String` | `"/v2/api-docs?group=default"` | OpenAPI 数据源路径 |
| `contextPath` | `String` | `"/"` | 上下文路径（since 4.1.0） |
| `order` | `Integer` | `0` | 排序（升序） |

---

## 聚合 Starter 配置

适用于 `knife4j-aggregation-spring-boot-starter` 和 `knife4j-aggregation-jakarta-spring-boot-starter`。

### `knife4j.enableAggregation`

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `knife4j.enableAggregation` | `boolean` | `false` | 启用聚合模式 |

### `knife4j.disk.*`

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `knife4j.disk.enable` | `boolean` | `false` | 启用 Disk 模式 |
| `knife4j.disk.routes` | List | — | Disk 路由列表 |

`knife4j.disk.routes[]`

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `name` | `String` | — | 服务名（UI 分组显示） |
| `location` | `String` | — | OpenAPI 文件路径（classpath 或 URL） |
| `debugUrl` | `String` | — | 调试目标 URL |
| `swaggerVersion` | `String` | `"2.0"` | 规范版本（`2.0` 或 `3.0`） |
| `servicePath` | `String` | — | 微服务路径（网关 basePath） |
| `order` | `Integer` | `1` | 排序 |

### `knife4j.cloud.*`

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `knife4j.cloud.enable` | `boolean` | `false` | 启用 Cloud 模式 |
| `knife4j.cloud.routes` | List | — | Cloud 路由列表 |
| `knife4j.cloud.routeAuth` | Object | — | 通用路由认证 |

`knife4j.cloud.routes[]`

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `name` | `String` | 服务名 |
| `uri` | `String` | OpenAPI 实例 URI（如 `http://192.168.0.1:8999`） |
| `location` | `String` | OpenAPI 文件路径 |
| `debugUrl` | `String` | 调试目标 URL |
| `swaggerVersion` | `String` | 规范版本 |
| `servicePath` | `String` | 微服务路径 |
| `routeAuth` | Object | 路由级认证（覆盖通用配置） |
| `order` | `Integer` | 排序 |

### `knife4j.nacos.*`

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `knife4j.nacos.enable` | `boolean` | `false` | 启用 Nacos 模式 |
| `knife4j.nacos.serviceUrl` | `String` | — | Nacos 地址（如 `http://192.168.0.1:8848/nacos`） |
| `knife4j.nacos.secret` | `String` | — | 接口访问密钥 |
| `knife4j.nacos.serviceAuth` | Object | — | Nacos 注册中心认证 |
| `knife4j.nacos.routeAuth` | Object | — | 通用路由认证 |
| `knife4j.nacos.routes` | List | — | Nacos 路由列表 |

`knife4j.nacos.routes[]`

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `serviceName` | `String` | 服务名（必填） |
| `groupName` | `String` | Nacos 分组 |
| `namespaceId` | `String` | 命名空间 ID |
| `clusters` | `String` | 集群名（逗号分隔） |
| *(继承 `CommonRoute`)* `name`, `location`, `debugUrl`, `swaggerVersion`, `servicePath`, `order`, `routeAuth` | | 同 Cloud 路由 |

### `knife4j.eureka.*`

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `knife4j.eureka.enable` | `boolean` | `false` | 启用 Eureka 模式 |
| `knife4j.eureka.serviceUrl` | `String` | — | Eureka 地址（如 `http://localhost:10000/eureka/`） |
| `knife4j.eureka.serviceAuth` | Object | — | Eureka 注册中心认证 |
| `knife4j.eureka.routeAuth` | Object | — | 通用路由认证 |
| `knife4j.eureka.routes` | List | — | Eureka 路由列表 |

`knife4j.eureka.routes[]`

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `serviceName` | `String` | 服务名（必填） |
| *(继承 `CommonRoute`)* `name`, `location`, `debugUrl`, `swaggerVersion`, `servicePath`, `order`, `routeAuth` | | 同 Cloud 路由 |

### `knife4j.polaris.*`

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `knife4j.polaris.enable` | `boolean` | `false` | 启用 Polaris 模式 |
| `knife4j.polaris.serviceUrl` | `String` | — | Polaris 地址 |
| `knife4j.polaris.serviceAuth` | Object | — | Polaris 注册中心认证 |
| `knife4j.polaris.jwtCookie` | `String` | — | 接口访问 JWT Cookie |
| `knife4j.polaris.routeAuth` | Object | — | 通用路由认证 |
| `knife4j.polaris.routes` | List | — | Polaris 路由列表 |

`knife4j.polaris.routes[]`

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `service` | `String` | 服务名（必填） |
| `namespace` | `String` | 命名空间 ID |
| *(继承 `CommonRoute`)* `name`, `location`, `debugUrl`, `swaggerVersion`, `servicePath`, `order`, `routeAuth` | | 同 Cloud 路由 |

### `knife4j.openapiv3.*`（聚合 Jakarta 版）

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `knife4j.openapiv3.url` | `String` | `"/v3/api-docs"` | OpenAPI 数据源 URL |
| `knife4j.openapiv3.oauth2RedirectUrl` | `String` | `""` | OAuth2 重定向 URL |
| `knife4j.openapiv3.validatorUrl` | `String` | `""` | Validator URL |
| `knife4j.openapiv3.tagsSorter` | `alpha` / `order` | `alpha` | Tag 排序规则（since 4.5.0） |
| `knife4j.openapiv3.operationsSorter` | `alpha` / `order` | `alpha` | Operation 排序规则（since 4.5.0） |

### `knife4j.basic-auth.*`（聚合版）

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `knife4j.basic-auth.enable` | `boolean` | `false` | 启用认证 |
| `knife4j.basic-auth.username` | `String` | — | 用户名 |
| `knife4j.basic-auth.password` | `String` | — | 密码 |

### `knife4j.connection-setting.*`

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `knife4j.connection-setting.socketTimeout` | `int` | `10000` | Socket 超时（ms） |
| `knife4j.connection-setting.connectTimeout` | `int` | `10000` | 连接超时（ms） |
| `knife4j.connection-setting.maxConnectionTotal` | `int` | `200` | 最大连接数 |
| `knife4j.connection-setting.maxPreRoute` | `int` | `20` | 单路由最大连接数 |

---

## 反向代理场景（nginx prefix / X-Forwarded-Prefix）

当应用部署在 nginx 等反向代理后面，外网访问路径带有前缀（如 `/prod-api/dispatch`），而 knife4j 前端拼出的 `api-docs` URL 没有该前缀时，会出现 404。这是 upstream [#849](https://github.com/xiaoymin/knife4j/issues/849) 描述的典型场景。

### 推荐方案：标准 Forwarded Header 透传

**Spring Boot 侧**（`application.yml`）：

```yaml
server:
  forward-headers-strategy: framework
```

**nginx 侧**：

```nginx
# 注意：location 末尾的斜杠与 proxy_pass 末尾的斜杠配合，
# 让 nginx 在转发时自动剥离 /prod-api/dispatch 前缀。
# X-Forwarded-Prefix 不带末尾斜杠，与 Spring 的 ForwardedHeaderFilter 期望一致。
location /prod-api/dispatch/ {
    proxy_pass http://backend:8080/;
    proxy_set_header X-Forwarded-Prefix /prod-api/dispatch;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host  $host;
    proxy_set_header X-Forwarded-Port  $server_port;
}
```

配置生效后，springdoc 会通过标准 `ForwardedHeaderFilter` 自动派生 base URL，`/v3/api-docs/swagger-config` 返回的 `urls[].url` 将携带 `/prod-api/dispatch` 前缀，knife4j 前端可正常加载文档。

### 验证方式

```bash
# 带前缀 header 请求，urls[].url 应包含 /prod-api/dispatch
curl -s -H "X-Forwarded-Prefix: /prod-api/dispatch" \
     http://localhost:8080/v3/api-docs/swagger-config | jq '.urls'

# 不带 header 请求，作为对照（url 不含前缀）
curl -s http://localhost:8080/v3/api-docs/swagger-config | jq '.urls'
```

### 注意事项

- `server.forward-headers-strategy=framework` 会注册 Spring 的 `ForwardedHeaderFilter`，它在 Servlet 层面重写 `HttpServletRequest` 的 scheme/host/contextPath，对所有 springdoc 端点透明生效，**无需修改 knife4j 配置**。
- 若使用 `server.forward-headers-strategy=native`，则由容器（Tomcat/Jetty）处理 `X-Forwarded-Proto/Host/Port`，但**不支持 `X-Forwarded-Prefix`**（Tomcat 原生不识别该 header），因此 `native` 模式**无法**完成 prefix 重写，不适用于本场景；请使用 `framework`。
- 若同时启用了 `knife4j.basic.enable=true`，需确认 nginx 传递的路径与 `knife4j.basic.include` 规则匹配，否则带前缀的 api-docs 请求会被 Basic Auth filter 拦截返回 401。
- Spring Boot 3.x（Jakarta / Spring Framework 6.x）与 Spring Boot 2.7.x（javax / Spring Framework 5.3）均支持上述配置。注意：`ForwardedHeaderFilter` 在 Spring Framework 6.x 中若重复注册会抛出异常（`IllegalStateException`），请勿在 `WebMvcConfigurer` 中手动再注册一次；Spring Framework 5.3 对重复注册的处理较宽松，但同样建议避免。

---

## 配置示例

### 最小配置（WebMvc + OpenAPI3）

```yaml
knife4j:
  enable: true
```

这依赖 springdoc 的默认路径：OpenAPI JSON 为 `/v3/api-docs`，Swagger UI 为 `/swagger-ui.html`。
`knife4j.setting.language` 默认是 `zh_cn`，无需为中文界面重复配置。

如果需要收窄 Controller 扫描范围、改变排序或关闭 springdoc 的通用响应包装，请按项目需要追加：

```yaml
springdoc:
  override-with-generic-response: false
  packages-to-scan: com.example.demo.controller
  paths-to-match: /api/**
  swagger-ui:
    tags-sorter: alpha
```

### 生产环境配置

```yaml
knife4j:
  enable: true
  production: true
  basic:
    enable: true
    username: admin
    password: ${DOC_PASSWORD}
```

> **生产环境响应格式**：`production=true` 时，被屏蔽的请求返回 `application/json` 格式的错误响应（`{"code":403,"message":"..."}`），而非 HTML 错误页面，避免前端 `JSON.parse` 时抛出 `Unexpected token '<', "<!DOCTYPE "...` 异常。

### Gateway 聚合配置（DISCOVER 模式）

```yaml
knife4j:
  gateway:
    enabled: true
    strategy: discover
    discover:
      enabled: true
      version: openapi3
      excludedServices:
        - gateway-service
    basic:
      enable: true
      username: admin
      password: ${DOC_PASSWORD}
```

### Nacos 聚合配置

```yaml
knife4j:
  enableAggregation: true
  nacos:
    enable: true
    serviceUrl: http://127.0.0.1:8848/nacos
    routes:
      - name: 用户服务
        serviceName: user-service
        groupName: DEFAULT_GROUP
        namespaceId: public
