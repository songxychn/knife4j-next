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

1. 版本发布节奏：upstream 最新是 `4.6.0`，fork 是 `5.0.1`（采用独立 SemVer 版本号）；fork 包含已确认并合入的兼容/安全修复和 React 新前端。
2. 新 React 前端覆盖范围：upstream Vue2 前端上有的 UI 功能（Postman 导出、afterScript、自定义 Footer、版本小蓝点等）在本 fork 的新 React 前端中尚未全部覆盖；OAuth2、离线导出、自定义 Markdown 文档等能力则已在 React UI 中补齐或重做。这些历史功能在本仓库 `knife4j-vue3`（`knife4j-openapi2-ui` 打包产物）中继续保留。详见下文 [React 配置不生效](#react-setting-not-effective)。

### 本 fork 相比 upstream 多了哪些修复

| 版本 | 修复/新增内容 | 对应 upstream issue |
| --- | --- | --- |
| `5.0.1` | 补丁修复：反向代理 prefix / swagger-config 发现、OAS2 webjar 构建产物、特殊字符路由、分组搜索状态、schema 显示细节 | — |
| `5.0.0` | Bug 修复 & 功能增强：petstore 闪烁、OAuth2 四种 flow 基础鉴权、离线文档 Markdown/OpenAPI JSON、tags-sorter | — |
| `1.0.0` | 正式版：全部 fork 安全修复 + Boot 3.4/3.5 兼容 + React UI 完整集成 | — |
| `4.6.0.3` (Preview) | `/v2/api-docs;xxx` 分号绕过 Basic 认证漏洞 | [#886](https://github.com/xiaoymin/knife4j/issues/886) |
| `4.6.0.3` (Preview) | Gateway context-path 导致 host 缺少斜杠 | [#954](https://github.com/xiaoymin/knife4j/issues/954) |
| `4.6.0.3` (Preview) | Spring Boot 3.4/3.5 兼容（springdoc 版本升级） | [#874](https://github.com/xiaoymin/knife4j/issues/874) [#882](https://github.com/xiaoymin/knife4j/issues/882) [#913](https://github.com/xiaoymin/knife4j/issues/913) |
| `4.6.0.3` (Preview) | 新 React 前端首次集成 | — |

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

本 fork 修复了 `/v2/api-docs;xxx` 利用分号绕过 `knife4j.basic` 认证的问题（[#886](https://github.com/xiaoymin/knife4j/issues/886)）。**生产环境建议升级到 `5.0.1`**。

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

如果你用的是 `knife4j-openapi3-spring-boot-starter` 或 `knife4j-openapi3-jakarta-spring-boot-starter`（也就是新 React 前端），React 会读取后端注入到 OpenAPI JSON 的 `x-openapi.x-setting`，并消费以下已接入字段：

- `knife4j.setting.language`
- `knife4j.setting.enable-search`
- `knife4j.setting.enable-debug`
- `knife4j.setting.enable-open-api`
- `knife4j.setting.enable-swagger-models` / `swagger-model-name`
- `knife4j.setting.enable-host` / `enable-host-text`
- `knife4j.setting.enable-group`
- `knife4j.setting.enable-footer`

用户在 React 设置面板里的本地选择会覆盖后端默认值。注意：`enable-debug=false` 只是隐藏调试入口，不是安全控制；线上屏蔽请使用 `knife4j.production`、`knife4j.basic` 或外层安全框架。

以下 UI 配置暂不生效：

- `knife4j.setting.enable-version=true`
- `knife4j.setting.enable-footer-custom`
- `knife4j.setting.enable-home-custom` / `home-custom-path`
- `knife4j.setting.enable-after-script`
- `knife4j.setting.enable-reload-cache-parameter`
- `knife4j.setting.enable-request-cache`
- `knife4j.setting.enable-dynamic-parameter`
- `knife4j.setting.enable-filter-multipart-apis`
- `knife4j.setting.enable-response-code`

原因：这些字段对应的 Vue 版能力尚未在 React 新前端里实现，或还没有接到实际行为上。后端 `ProductionSecurityFilter`、`knife4j.basic`、`knife4j.documents` 等服务端侧能力不受影响。

过渡方案：

- 如果你重度依赖这些 UI 能力，暂时使用 `knife4j-openapi2-spring-boot-starter`（前端为本仓库 `knife4j-vue3`），或 upstream `com.github.xiaoymin` 的同名依赖（前端为 upstream Vue 2 webjar）。
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

1. **未引入 `springdoc-openapi-*-ui` 依赖**——应由 starter 自动带入。如果你用的是本 fork `5.0.1`，starter 已包含该依赖，无需手动添加。如果你用的是 upstream `4.0.0`，需要手动加 `springdoc-openapi-ui`（已在 `4.1.0` 修复）。
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

使用最新版本（`5.0.1`）且未自定义 MessageConverter 时不会遇到此问题。

### `@ParameterObject` 展开的参数在 UI 上是扁平列表

这是 springdoc 默认行为。`@ParameterObject` 会把对象内每个字段展开成独立 query 参数。这是**设计如此**，不是 bug。如果你希望作为整体 JSON 传入，用 `@RequestBody`。

### `GET /foo/{id}` 在调试页上所有 tab 都灰掉，无法编辑 path 参数 {#missing-path-variable}

**症状**：形如 `@GetMapping("/{id}") public Xxx get(@PathVariable Long id)` 的接口，调试页 Path / Query / Header / Body 全部 tab 都是灰的，点不开。查看 `/v3/api-docs` 发现该操作的 `parameters` 是 `[]`。

**根因**：编译时没开 `-parameters`，导致 class 文件里没有 `MethodParameters` 属性。Spring / Springdoc 无法通过反射拿到参数名 `id`，在参数没显式写 `name` 的情况下会**丢弃整个参数**。`@PathVariable` 不写 `value` / `@Parameter` 不写 `name` 时尤其明显。

**诊断**（任选其一）：

```bash
# 1. 看 OpenAPI 文档
curl -s http://localhost:8080/v3/api-docs | jq '.paths."/your/path/{id}".get.parameters'
# 输出 [] 就是这个问题

# 2. 看 class 字节码
javap -v target/classes/com/your/YourController.class | grep MethodParameters
# 没有任何输出就是没开 -parameters
```

**修复（推荐）**：在 Maven `maven-compiler-plugin` 里开启 `-parameters`：

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-compiler-plugin</artifactId>
  <configuration>
    <parameters>true</parameters>
  </configuration>
</plugin>
```

继承 `spring-boot-starter-parent` 的项目默认已经带 `-parameters`，无需额外配置。如果你没继承、或者用的是 Gradle，自行在各自构建工具中开启即可（Gradle：`tasks.withType(JavaCompile) { options.compilerArgs << '-parameters' }`）。

**替代方案**：在注解里显式写参数名。适合不方便改构建配置的场景，但侵入代码：

```java
@GetMapping("/{id}")
public UserVO getById(
    @Parameter(name = "id", description = "用户 ID")
    @PathVariable("id") Long id) { ... }
```

**降级兜底**：Knife4j UI 会在 OpenAPI 文档里 `parameters: []` 但 URL 模板含 `{xxx}` 时，自动把占位符补成 `string` 类型的 path 参数输入框——因此**即便后端 OpenAPI 文档不完整，调试页也不会再整页灰掉**。但补出来的参数丢失了原始 `description` / `type` / `example`，仍建议按上面两种方式从源头修复。

### Spring Boot 3.4 / 3.5 启动报错

如果你用的是 upstream `4.5.0` 或更早版本，在 Boot 3.4+ 上会遇到 `NoSuchMethodError` 或 `ClassNotFoundException`。本 fork `5.0.0` 起已将 springdoc-openapi 升级到 `2.8.9`，解决了此问题。

修复方法：升级到 `com.baizhukui:knife4j-openapi3-jakarta-spring-boot-starter:5.0.1`。

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

upstream `4.5.0` 及更早版本在 Boot 3.4+ 上会遇到 `NoSuchMethodError` 或 `ClassNotFoundException`。本 fork `5.0.0` 起已将 springdoc-openapi 升级到 `2.8.9`，解决了此问题。

**修复**：升级到 `com.baizhukui:knife4j-openapi3-jakarta-spring-boot-starter:5.0.1`。

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

## 访问控制与安全

### Spring Security 如何放行文档路径

如果你使用了 Spring Security，`/doc.html` 和相关 API 端点会被拦截。需要在 Security 配置中放行：

**OpenAPI3（springdoc）需要放行的路径：**

| 路径 | 用途 |
| --- | --- |
| `/doc.html` | Knife4j 文档页面 |
| `/webjars/**` | 前端静态资源 |
| `/v3/api-docs/**` | OpenAPI3 JSON 端点 |
| `/swagger-ui/**` | springdoc 自带的 Swagger UI（如需访问） |

**OpenAPI2（Springfox）额外需要放行的路径：**

| 路径 | 用途 |
| --- | --- |
| `/v2/api-docs` | Swagger2 JSON 端点 |
| `/swagger-resources/**` | 分组接口 |
| `/swagger-resources/configuration/ui` | UI 配置 |
| `/swagger-resources/configuration/security` | 安全配置 |

**Spring Boot 3.x 配置示例：**

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http.authorizeHttpRequests(auth -> auth
                .requestMatchers(
                    "/doc.html",
                    "/webjars/**",
                    "/v3/api-docs/**"
                ).permitAll()
                .anyRequest().authenticated()
        );
        return http.build();
    }
}
```

**Spring Boot 2.x 配置示例：**

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig extends WebSecurityConfigurerAdapter {

    @Override
    protected void configure(HttpSecurity http) throws Exception {
        http.authorizeRequests()
                .antMatchers("/doc.html", "/webjars/**",
                    "/v2/api-docs", "/v3/api-docs/**",
                    "/swagger-resources/**").permitAll()
                .anyRequest().authenticated();
    }
}
```

::: tip 替代方案
也可以使用 `knife4j.production` 或 `knife4j.basic` 来控制文档访问，无需修改 Security 规则。
:::

### 生产环境屏蔽文档的多种方式

| 方式 | 适合场景 | 配置 |
| --- | --- | --- |
| `knife4j.production: true` | 最简单，返回 403 | YAML 一行配置 |
| `knife4j.basic` | 需要密码保护 | YAML 配置用户名密码 |
| Spring Security 规则 | 已有 Security 体系 | 代码配置 |
| Nginx 层拦截 | 前端独立部署 | Nginx `return 403` |
| Maven Profile 排除 UI jar | 完全不打入生产包 | `pom.xml` exclusion |

## 序列化 & 数据类型

### 枚举类型在文档中显示不正确

**问题**：枚举字段在 UI 上只显示类型名（如 `UserStatus`），不显示可选值。

**原因**：springdoc 默认不解析枚举值。需要配置：

```yaml
springdoc:
  swagger-ui:
    display-request-duration: true
  show-enum-values: true    # springdoc-openapi 2.6.0+
```

或在枚举类上使用 `@Schema` 注解：

```java
@Getter
@AllArgsConstructor
public enum UserStatus {
    @Schema(description = "启用")
    ACTIVE(1, "启用"),
    @Schema(description = "禁用")
    DISABLED(0, "禁用");

    private final int code;
    private final String desc;
}
```

**Jackson 配置**（将枚举序列化为字符串而非序号）：

```yaml
spring:
  jackson:
    serialization:
      write-enums-using-to-string: true
```

### Date / LocalDateTime 显示为时间戳

springdoc 默认将日期类型映射为 `integer`（时间戳）。添加：

```yaml
spring:
  jackson:
    serialization:
      write-dates-as-timestamps: false
```

或在字段上显式声明：

```java
@Schema(description = "创建时间", example = "2024-01-01T00:00:00")
private LocalDateTime createdAt;
```

### Map / JSONObject 类型的参数展示

OpenAPI3 规范对自由格式 Map 的描述有限。推荐做法：

1. **定义明确的 DTO**：替代 `Map<String, Object>`，使用强类型字段。
2. **`@DynamicParameters`**：仅在 openapi2 starter 中可用（前端为本仓库 `knife4j-vue3`），详见 [Springfox 迁移](./springfox-migration)。
3. **`additionalProperties`**：OpenAPI3 的 Map 描述方式：

```java
@Schema(description = "扩展属性", additionalProperties = String.class)
private Map<String, String> extensions;
```

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
