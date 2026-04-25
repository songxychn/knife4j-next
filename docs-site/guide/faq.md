---
title: 常见问题
---

# 常见问题（FAQ）

## 关于本 fork

### 和 upstream knife4j 是什么关系

`knife4j-next` 是 [`xiaoymin/knife4j`](https://github.com/xiaoymin/knife4j) 的社区维护 fork。功能语义完全兼容，只改了 Maven `groupId`（`com.github.xiaoymin` → `com.baizhukui`）。详见 [产品介绍](./introduction)。

### 如何从 `com.github.xiaoymin` 切到 `com.baizhukui`

改 Maven 依赖 `groupId`，业务代码不动。详见 [迁移指引](./migration)。

### 可以回滚到 upstream 吗

可以。`com.github.xiaoymin:knife4j-*` 在 Maven Central 仍在，业务代码从未修改，只需在 `pom.xml` 里把坐标改回去。

### upstream 文档还有效吗

**大多数情况仍然有效**。upstream 文档 <https://doc.xiaominfo.com/> 上关于 `@ApiOperationSupport`、`knife4j.*` 配置、UI 行为的内容本 fork 完全兼容。两个例外：

1. 版本发布节奏：upstream 最新是 `4.6.0`，fork 是 `4.6.0.3`；fork 额外带 3 个 patch 的兼容/安全修复。
2. 新 React 前端覆盖范围：upstream Vue2 前端上有的 UI 功能（Postman 导出、afterScript、自定义 Footer、版本小蓝点等），本 fork 的新 React 前端尚未全部覆盖。详见下文 [React 配置不生效](#react-setting-not-effective)。

### 本 fork 相比 upstream 多了哪些修复

| 版本 | 修复内容 | 对应 upstream issue |
| --- | --- | --- |
| `4.6.0.1` | `/v2/api-docs;xxx` 分号绕过 Basic 认证漏洞 | [#886](https://github.com/xiaoymin/knife4j/issues/886) |
| `4.6.0.2` | Gateway context-path 导致 host 缺少斜杠 | [#954](https://github.com/xiaoymin/knife4j/issues/954) |
| `4.6.0.3` | Spring Boot 3.4/3.5 兼容（springdoc 版本升级） | [#874](https://github.com/xiaoymin/knife4j/issues/874) [#882](https://github.com/xiaoymin/knife4j/issues/882) [#913](https://github.com/xiaoymin/knife4j/issues/913) |
| `4.6.0.3` | 新 React 前端集成 | — |

## 访问与路径

### SpringBoot 访问 `doc.html` 404 {#doc-html-404}

按顺序排查：

1. **starter 是否真的在 classpath**：`mvn dependency:tree | grep knife4j`。
2. **`knife4j.enable=true` 是否加了**（openapi2 starter 需要，openapi3 starter 可选）。
3. **是否有 `server.servlet.context-path`**？应该访问 `http://host:port/<context-path>/doc.html`。
4. **是否有全局 `WebMvcConfigurer` 把 `/webjars/**` 排除了静态资源处理**？如果项目自定义了 `WebMvcConfigurer`，需要手动添加：

   ```java
   @Override
   public void addResourceHandlers(ResourceHandlerRegistry registry) {
       registry.addResourceHandler("doc.html")
               .addResourceLocations("classpath:/META-INF/resources/");
       registry.addResourceHandler("/webjars/**")
               .addResourceLocations("classpath:/META-INF/resources/webjars/");
   }
   ```

5. **是否同时引入了冲突的 Swagger UI**（`springfox-boot-starter`、`springdoc-openapi-ui` 非 Jakarta 版）？
6. **Spring Security / Shiro 是否拦截了 `/doc.html`、`/webjars/**`、`/v3/api-docs/**`**？需要放行这些路径。

### WebFlux 环境下 `doc.html` 404

WebFlux 没有 Servlet，不能混入 `spring-boot-starter-web`。确保：

1. 使用 `knife4j-openapi3-webflux-jakarta-spring-boot-starter`（而非 WebMvc 版）。
2. 不要引入 `spring-boot-starter-web`，只保留 `spring-boot-starter-webflux`。
3. 如果用了 Spring Cloud Gateway，不需要 webflux starter，改用 `knife4j-gateway-spring-boot-starter`。详见 [WebFlux 接入](./webflux) 和 [Gateway 聚合](./gateway)。

### Spring MVC（非 Boot）工程看不到接口文档

通用的非 Boot Spring MVC 工程需要手动配置静态资源：

```xml
<mvc:resources mapping="/doc.html" location="classpath:/META-INF/resources/"/>
<mvc:resources mapping="/webjars/**" location="classpath:/META-INF/resources/webjars/"/>
<mvc:resources mapping="/swagger-ui/**" location="classpath:/META-INF/resources/webjars/swagger-ui/"/>
```

以及 `<mvc:default-servlet-handler/>` 和 `<mvc:annotation-driven/>`。

### Nginx 反向代理后路径不对

启用 `server.forward-headers-strategy: framework` 让 Spring 感知 `X-Forwarded-*` 头：

```yaml
server:
  forward-headers-strategy: framework
```

并在 Nginx 透传相关头：

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

### `/doc.html` 需要带前缀

浏览器访问时仍然可以只写 `/doc.html`，但如果你想让前端 API 请求自动走前缀，请用 `server.servlet.context-path`。

## 生产环境 & 安全

### 生产环境怎么禁用 `doc.html`

```yaml
knife4j:
  production: true
```

这会让 `ProductionSecurityFilter` 对 `/doc.html`、`/v2/api-docs`、`/v3/api-docs`、`/swagger-resources`、`/swagger-ui` 等入口返回 403。

> 仅在 WebMvc（Servlet）starter 中生效。WebFlux starter 没有该过滤器，建议在网关层或 Spring Security 配置中限制访问。

### 只想给部分用户看文档

启用 Basic 认证：

```yaml
knife4j:
  basic:
    enable: true
    username: admin
    password: ${DOC_PASSWORD}
```

### 有安全修复吗

`4.6.0.1` 修复了 `/v2/api-docs;xxx` 利用分号绕过 `knife4j.basic` 认证的问题（[#886](https://github.com/xiaoymin/knife4j/issues/886)）。**生产环境建议至少升到 `4.6.0.1`**，更稳妥是 `4.6.0.3`。

### CSP（Content-Security-Policy）限制导致 UI 白屏

React 前端使用的是**非 inline** 脚本，通常 CSP `script-src 'self'` 即可。如果配置了 `default-src 'none'`，需要追加：

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
font-src 'self' data:;
connect-src 'self';
```

`'unsafe-inline'` 对 style 暂时需要（前端组件库用到 style 插入）；后续新前端会移除该依赖。

## 配置不生效

### 为什么我的 `knife4j.setting.*` 配置不生效 {#react-setting-not-effective}

如果你用的是 `knife4j-openapi3-spring-boot-starter` 或 `knife4j-openapi3-jakarta-spring-boot-starter`（也就是新 React 前端），**以下 UI 配置暂不生效**：

- `knife4j.setting.enable-debug=false`
- `knife4j.setting.enable-search=false`
- `knife4j.setting.enable-open-api=false`
- `knife4j.setting.enable-version=true`
- `knife4j.setting.enable-footer=false` / `enable-footer-custom`
- `knife4j.setting.enable-home-custom` / `home-custom-path`
- `knife4j.setting.swagger-model-name`
- `knife4j.setting.enable-after-script`
- `knife4j.setting.enable-reload-cache-parameter`
- `knife4j.setting.enable-host` / `enable-host-text`

原因：React 新前端当前**不读取**后端注入到 OpenAPI extension 的 `x-knife4j.setting` 字段。后端 `ProductionSecurityFilter`、`knife4j.basic`、`knife4j.documents` 等服务端侧能力不受影响。

过渡方案：

- 如果你重度依赖这些 UI 能力，暂时使用 `knife4j-openapi2-spring-boot-starter`（Vue2 UI），或 upstream `com.github.xiaoymin` 的同名依赖。
- 或者在 [路线图](../roadmap/#react-ui-coverage) 跟进覆盖进度。

### `knife4j.enable=true` 了但 UI 上看不到接口

通常是 springdoc 的 `packages-to-scan` 没配好，springdoc 不知道扫哪些 Controller：

```yaml
springdoc:
  group-configs:
    - group: default
      paths-to-match: /**
      packages-to-scan: com.your.project
```

### `No OpenAPI resource found for group: swagger-config` {#no-openapi-resource-found}

OpenAPI3 starter 下，前端会请求 `/v3/api-docs/swagger-config`。如果 404，通常是：

1. **未引入 `springdoc-openapi-*-ui` 依赖**——应由 starter 自动带入。如果你用的是本 fork `4.6.0.3`，starter 已包含该依赖，无需手动添加。如果你用的是 upstream `4.0.0`，需要手动加 `springdoc-openapi-ui`（已在 `4.1.0` 修复）。
2. **网关层把 `/v3/api-docs/**` 拦截了**。
3. **应用启动失败**，接口还未注册。

排查命令：

```bash
curl -I http://localhost:8080/v3/api-docs
curl -I http://localhost:8080/v3/api-docs/swagger-config
```

### `4.1.0` 之后接口响应显示 Base64 编码

如果你自定义了 `WebMvcConfigurer#configureMessageConverters`（比如加入 FastJson），springdoc 的 OpenAPI 接口可能返回 Base64 编码内容。解决方法是在自定义 converter 列表末尾追加 `ByteArrayHttpMessageConverter`：

```java
@Configuration
public class CommonWebMvcConfig implements WebMvcConfigurer {
    @Override
    public void configureMessageConverters(List<HttpMessageConverter<?>> converters) {
        converters.add(fastJsonHttpMessageConverter());
        // 必须追加，否则 springdoc-openapi 接口会响应 Base64 编码
        // 参考 https://github.com/springdoc/springdoc-openapi/issues/2143
        converters.add(new ByteArrayHttpMessageConverter());
    }
}
```

使用最新版本（`4.6.0.3`）且未自定义 MessageConverter 时不会遇到此问题。

### `@ParameterObject` 展开的参数在 UI 上是扁平列表

这是 springdoc 默认行为。`@ParameterObject` 会把对象内每个字段展开成独立 query 参数。这是**设计如此**，不是 bug。如果你希望作为整体 JSON 传入，用 `@RequestBody`。

### Spring Boot 3.4 / 3.5 启动报错

如果你用的是 upstream `4.5.0` 或更早版本，在 Boot 3.4+ 上会遇到 `NoSuchMethodError` 或 `ClassNotFoundException`。本 fork `4.6.0.3` 已将 springdoc-openapi 升级到 `2.8.9`，解决了此问题。

修复方法：升级到 `com.baizhukui:knife4j-openapi3-jakarta-spring-boot-starter:4.6.0.3`。

## 全局响应封装导致文档异常

### Knife4j 文档请求异常弹窗

如果你在项目中对所有 Controller 返回值做了统一封装（比如 `Result<T>` 包装），可能导致 `/v3/api-docs` 或 `/swagger-resources` 的响应也被包装，使得前端解析失败。

**症状**：打开 `doc.html` 弹出"Knife4j文档请求异常"。

**排查**：

1. 用浏览器 F12 → Network 查看 `/v3/api-docs/swagger-config` 和 `/v3/api-docs` 的响应。
2. 如果响应体被 `{"code": 0, "data": {...}}` 之类的外壳包裹，说明全局封装拦截了文档接口。

**解决**：在全局封装逻辑中排除文档相关路径：

```java
@Component
public class GlobalResponseWrapper implements ResponseBodyAdvice<Object> {
    @Override
    public boolean supports(MethodParameter returnType, Class<? extends HttpMessageConverter<?>> converterType) {
        return true;
    }

    @Override
    public Object beforeBodyWrite(Object body, MethodParameter returnType, MediaType selectedContentType,
            Class<? extends HttpMessageConverter<?>> selectedConverterType,
            ServerHttpRequest request, ServerHttpResponse response) {
        String path = request.getURI().getPath();
        // 排除 OpenAPI 文档相关接口
        if (path.startsWith("/v3/api-docs") || path.startsWith("/v2/api-docs")
                || path.startsWith("/swagger-resources") || path.startsWith("/swagger-ui")) {
            return body;
        }
        // 正常封装
        return Result.ok(body);
    }
}
```

### `/v3/api-docs` 返回非法 JSON

另一种常见情况：List 类型字段的 `@ApiModelProperty(example = "{'id':'xxx'}")` 生成了非法 JSON。springdoc 在解析时可能把 example 原样写入，导致前端 `JSON.parse()` 失败。

**解决**：移除集合属性上的 `example`，让框架自动生成。或确保 example 是合法 JSON。

## 注解 / 字段说明

### `@DynamicParameters` 怎么不生效了

`@DynamicParameters` 和 `@DynamicResponseParameters` 是 Springfox 专属特性。在：

- `knife4j-openapi2-spring-boot-starter`：**仍然生效**。
- `knife4j-openapi3-spring-boot-starter` / `knife4j-openapi3-jakarta-spring-boot-starter`：**已在 upstream v4.0 弃用**，注解保留但不处理。

迁到 OpenAPI3 后，请改用实体类：

```java
public class UserCreateRequest {
    @Schema(description = "用户名", example = "alice")
    private String name;

    @Schema(description = "年龄", example = "18")
    private Integer age;
}
```

### `@ApiOperationSupport(ignoreParameters = ...)` 不生效

同上，`ignoreParameters` / `includeParameters` 是 Springfox Plugin 特性，只在 openapi2 starter 生效。在 openapi3 系列中只有 `author` 和 `order` 两个属性被处理。

### Swagger 字段属性说明不显示

OpenAPI3 下使用 `@Schema(description = "...")` 注解字段。OpenAPI2 下使用 `@ApiModelProperty(value = "...")`。注意**不要混用**。

### 文件上传没有文件选择控件

Controller 方法参数要么是 `MultipartFile`（webmvc）要么是 `FilePart`（webflux）。在 OpenAPI3 下加 `@RequestPart` 注解：

```java
@PostMapping(value = "/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
public void upload(@RequestPart("file") MultipartFile file) { ... }
```

### `@Api` 和 `@ApiModel` 能不能用

- OpenAPI2 starter（Springfox）：`@Api`、`@ApiModel`、`@ApiModelProperty`、`@ApiOperation` 等正常使用。
- OpenAPI3 starter（springdoc）：这些注解**不建议使用**。springdoc 可以识别部分 Swagger 1.x 注解但行为不可预测，请统一使用 `@Tag`、`@Schema`、`@Operation`。

## 异常

### `java.lang.NumberFormatException: For input string: ""`

通常因为 `@ApiModelProperty(example = "")` 或 `@ApiImplicitParam(example = "")` 给了空字符串但字段是数值类型。把 `example` 改成合法数字或移除。

### `NoSuchMethodError` 相关 Springfox

多为 `springfox-swagger2` 不同版本混用。本 fork 使用 `springfox 2.10.5`，确保不要手动引入其他版本。

如果是 Boot 3.4+ 的 `NoSuchMethodError`，参见上文 [Spring Boot 3.4 / 3.5 启动报错](#spring-boot-34-35)。

### Spring Boot 3.4 / 3.5 启动报错 {#spring-boot-34-35}

upstream `4.5.0` 及更早版本在 Boot 3.4+ 上会遇到 `NoSuchMethodError` 或 `ClassNotFoundException`。本 fork `4.6.0.3` 已将 springdoc-openapi 升级到 `2.8.9`，解决了此问题。

**修复**：升级到 `com.baizhukui:knife4j-openapi3-jakarta-spring-boot-starter:4.6.0.3`。

### `Servlet` 相关的 ClassNotFoundException（WebFlux 环境）

不要在 WebFlux 项目中引入 `spring-boot-starter-web` 或 WebMvc 版 starter。WebFlux 项目使用 `knife4j-openapi3-webflux-*-spring-boot-starter`。

## Gateway & 聚合

### Gateway 聚合后看不到子服务接口

1. 确认子服务的 `/v3/api-docs` 在 Gateway 内网可达。
2. Gateway starter 使用 DISCOVER 策略时，确认 `spring.cloud.discovery.reactive.enabled=true`。
3. 使用 MANUAL 策略时，确认 `knife4j.gateway.routes` 里的 `service-name` 和 `url` 配置正确。
4. 详见 [Gateway 聚合](./gateway)。

### 聚合模式（Disk / Cloud / Nacos / Eureka / Polaris）怎么选

- **Disk**：开发/测试环境，Swagger JSON 文件在本地 classpath。
- **Cloud**：通过 Spring Cloud Discovery 发现服务。
- **Nacos**：从 Nacos 注册中心拉取服务列表。
- **Eureka**：从 Eureka 注册中心拉取服务列表。
- **Polaris**：从北极星注册中心拉取服务列表。

详见 [独立聚合](./aggregation)。

## 其他

### 历史旧版 FAQ 在哪

upstream `doc.xiaominfo.com` 仍在提供完整的历史 FAQ，如 Springfox 2.9.2 的相关异常、离线文档 Markdown 格式错乱等。fork 完全兼容，相关问题可以直接参考：

- [upstream FAQ 索引](https://doc.xiaominfo.com/docs/faq)
- [upstream Springfox 2.9.2 NoSuchMethodError](https://doc.xiaominfo.com/docs/faq/sp-nmerror)
- [upstream 文件上传问题](https://doc.xiaominfo.com/docs/faq/upload-error)
- [upstream Knife4j文档请求异常](https://doc.xiaominfo.com/docs/faq/knife4j-exception)

### 还是没解决？

- 查 [GitHub Issues](https://github.com/songxychn/knife4j-next/issues)
- 提 issue 时请带上：knife4j 版本、Spring Boot 版本、是否用 jakarta、关键配置片段、最小复现。

