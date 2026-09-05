---
title: OpenAPI 3.1 支持与迁移
description: Knife4j Next 对 OpenAPI 3.1.x 的支持矩阵、JSON Schema 2020-12 边界、安全模型、浏览器限制与迁移示例。
---

# OpenAPI 3.1 支持与迁移

[English contract](./openapi31-en) · [下载最小 JSON](/examples/openapi-3.1-minimal.json) · [下载最小 YAML](/examples/openapi-3.1-minimal.yaml)

本文描述 Java `5.5.0` 的 OpenAPI 3.1 契约，具体能力与版本归属见
[发布说明](../release-notes/)和 [版本参考](../reference/version-ref)。Knife4x Go 使用独立版本，
请查阅 [Go 发布说明](../knife4x/)。本文不改变任何 starter 或默认配置。

## 支持范围

OpenAPI 的功能集由 `major.minor` 定义。`3.1.x` 因此使用同一套 **OpenAPI 3.1 feature set**，不按 patch 版本拆分能力，
离线导出也复用统一版本判断，不维护私有 patch 白名单。已有 OpenAPI 3.0.x 路径继续保留，OpenAPI 3.2.x 不在当前范围。

| 文档版本 | UI | 状态 | 说明 |
| --- | --- | --- | --- |
| Swagger / OpenAPI 2.0 | Vue 3 | 兼容维护 | 由 openapi2 starter 提供，不扩展 OAS 3.1 能力 |
| OpenAPI 3.0.x | React | 支持 | 沿用既有解析、调试、导出与变化提示路径 |
| OpenAPI 3.1.x | React | 支持 | 使用同一 feature set，并遵守下列产品边界 |
| OpenAPI 3.2.x | React | 不支持 | 不猜测或降级成 3.1 处理 |

### springdoc 生成矩阵

| Spring Boot | starter / springdoc | 生成结果 | 已验证路径 | 证据 |
| --- | --- | --- | --- | --- |
| Boot 2.x | openapi3 非 Jakarta / springdoc `1.8.0` | OpenAPI 3.0.x | 保持既有兼容基线 | [#737](https://github.com/songxychn/knife4j-next/pull/737) |
| Boot 3.x WebMVC | openapi3 Jakarta / springdoc `2.8.9` | 显式开启 OpenAPI 3.1 | 真实 `/v3/api-docs` → Java smoke → React / SchemaEngine | [#737](https://github.com/songxychn/knife4j-next/pull/737) |
| Boot 3.x WebFlux | webflux Jakarta / springdoc `2.8.9` | 显式开启 OpenAPI 3.1 | 真实 `/v3/api-docs` → Java smoke → React / SchemaEngine | [#737](https://github.com/songxychn/knife4j-next/pull/737) |
| Boot 4.x WebMVC | Boot4 starter / springdoc `3.0.3` | 默认或显式 OpenAPI 3.1 | 两种配置都经过端到端验证 | [#737](https://github.com/songxychn/knife4j-next/pull/737) |

Boot 3 项目显式生成 OAS 3.1 文档：

```yaml
springdoc:
  api-docs:
    version: OPENAPI_3_1
```

Boot 2 / springdoc 1.8.0 仍生成 OAS 3.0，不能仅修改文档中的 `openapi` 字符串冒充 OAS 3.1。
完整 starter 版本组合见[兼容矩阵](../reference/compatibility)。

## 产品能力矩阵

除非某行另有说明，下表的“支持”指整个 OpenAPI 3.1.x feature set。

| 能力 | OAS 3.1.x 行为 | 关键边界 | 已合并证据 |
| --- | --- | --- | --- |
| 单文档与多文档加载 | 入口文档与受控跨文档资源使用同一 3.1 解析会话 | 3.2 文档拒绝进入 3.1 工作流 | [#682](https://github.com/songxychn/knife4j-next/pull/682)、[#689](https://github.com/songxychn/knife4j-next/pull/689)、[#727](https://github.com/songxychn/knife4j-next/pull/727) |
| 文档对象与 Webhook | 支持 `paths`、`components`、`webhooks` 与 3.1 Reference Object；三者至少声明一个 | Webhook 是入站契约，不等同于普通 Path 请求 | [#717](https://github.com/songxychn/knife4j-next/pull/717) |
| Schema 方言 | 使用 OAS 3.1 Base Dialect 与 JSON Schema Draft 2020-12 标准词汇 | 不把任意自定义方言解释为标准语义 | [#687](https://github.com/songxychn/knife4j-next/pull/687)、[#689](https://github.com/songxychn/knife4j-next/pull/689) |
| 字段树与模型 | 支持 3.1 类型联合、布尔 Schema、`const`、条件与组合关键字、动态引用等 | 不执行自定义词汇；未知关键字、example 与 extension 的普通载荷保持 opaque，Schema 保留名不参与资源声明预扫描 | [#692](https://github.com/songxychn/knife4j-next/pull/692)、[#694](https://github.com/songxychn/knife4j-next/pull/694)、[#743](https://github.com/songxychn/knife4j-next/pull/743) |
| 示例 | 保留作者示例并报告不一致；无作者示例时可在预算内生成确定性候选 | 不是通用 JSON Schema 求解器 | [#715](https://github.com/songxychn/knife4j-next/pull/715) |
| 参数调试 | 手填 Path、Query、Header、Cookie 按 3.1 Schema 验证，再按 `style` / `explode` 序列化 | 一个参数使用 `schema` 或一个 `content` 媒体类型；手填 Cookie 只进入预览 / cURL，浏览器会话来源的 Cookie 由浏览器携带、前端无法校验 | [#716](https://github.com/songxychn/knife4j-next/pull/716) |
| urlencoded / multipart Body | 支持结构化字段、`encoding`、JSON part 与文件元数据检查 | 不读取或验证上传文件内容 | [#728](https://github.com/songxychn/knife4j-next/pull/728)、[#730](https://github.com/songxychn/knife4j-next/pull/730) |
| 请求诊断 | Schema 诊断先阻止发送；同一快照可由用户显式选择“仍然发送”做负向测试 | 不绕过浏览器、安全或资源策略 | [#696](https://github.com/songxychn/knife4j-next/pull/696)、[#716](https://github.com/songxychn/knife4j-next/pull/716)、[#728](https://github.com/songxychn/knife4j-next/pull/728) |
| 响应诊断 | 按精确状态码、范围或 `default` 以及媒体类型匹配 JSON 响应 Schema | 非阻断；不验证响应 Header、Cookie、SSE 或二进制内容 | [#713](https://github.com/songxychn/knife4j-next/pull/713) |
| 单接口导出 | 完整资源图下导出可移植的单接口 OpenAPI JSON；支持 Path 与 Webhook 操作 | 不导出 YAML、ZIP、多文件包或整服务闭包 | [#732](https://github.com/songxychn/knife4j-next/pull/732)、[#733](https://github.com/songxychn/knife4j-next/pull/733) |
| 接口变化提示 | 为完整资源图生成 3.1 语义指纹，与 3.0 基线隔离 | 只跟踪 `paths` 操作，不跟踪 Webhook 或字段级 diff | [#736](https://github.com/songxychn/knife4j-next/pull/736) |
| 离线文档 | HTML、Markdown、DOC、DOCX 使用同一不可变 3.1 快照 | 快照入口复用统一 3.1.x 版本判断；资源缺失或诊断未处理时取消，或由用户明确选择降级导出 | [#734](https://github.com/songxychn/knife4j-next/pull/734) |

真实 springdoc 到浏览器的总体验收见 [#737](https://github.com/songxychn/knife4j-next/pull/737)。

## 登录后带 Cookie 调试

在“Cookie 会话”页面配置并发送登录请求，服务端响应的 `Set-Cookie` 由浏览器按策略接收，
包括前端无法读取的 HttpOnly Cookie。返回接口调试页后，在 Cookie 页签选择“浏览器会话”，
即可复用浏览器登录会话，无须复制或填写 Cookie 值。

- 新建 OAS 3.1 调试表单默认使用浏览器会话；旧缓存或历史未记录来源时，按原来的手填模式恢复。
- 文档中的 Cookie 必填声明仍会显示，但值标为“由浏览器携带（前端未校验）”。前端既不因无法读取 Cookie 而阻断，也不宣称它存在或已通过 Schema 校验；服务端仍按实际会话处理请求。
- 默认只携带同源会话。API 跨 origin 时，需要选择 `include`，并由服务端配置允许该页面 origin 和凭据的 CORS；这不会绕过 SameSite、Secure、domain/path 或浏览器 Cookie 策略。跨 origin 不一定跨 site。
- 预览和历史不包含浏览器实际 Cookie 值；生成的 cURL 带有缺少浏览器会话的说明，独立执行前需要自行配置 Cookie。
- 切换为“手填 Cookie”后可继续编辑原有值并生成 cURL，手填 Cookie 的浏览器发送仍被阻断。请求头或鉴权配置中残留的显式 Cookie 也会阻断，应先移除这些手填配置。

按分组保存的是登录/退出请求与携带策略，实际 Cookie 按浏览器规则共享，不按 Knife4j 分组或端口隔离。
重置会话配置不会删除浏览器 Cookie；退出会话需要由已配置的服务端退出接口处理。
登录或退出请求的 HTTP 成功提示，仅说明请求成功执行，不代表前端已确认 Cookie 保存、删除或业务登录状态。

## JSON Schema 方言与词汇

### 默认方言

OAS 3.1 Schema Object 是 JSON Schema Draft 2020-12 的方言。根级 `jsonSchemaDialect` 未声明时，
Knife4j 使用 OAS 3.1 Base Dialect：

```yaml
jsonSchemaDialect: https://spec.openapis.org/oas/3.1/dialect/base
```

当前 SchemaEngine 只执行以下两种已知方言的验证语义：

- `https://spec.openapis.org/oas/3.1/dialect/base`
- `https://json-schema.org/draft/2020-12/schema`

### 标准与自定义词汇

JSON Schema 2020-12 的 Core、Applicator、Validation、Unevaluated、Meta-Data、Format Annotation 与
Content 标准词汇按方言处理。`format` 默认是注解，不因浏览器里出现一个格式字符串就自动产生网络、文件或证书能力。

未知扩展关键字和自定义词汇载荷会保留在原始文档中；SchemaEngine 会话成功时，复制与可移植导出也保留这些值，
但 Knife4j 不为它们定义验证、示例生成或字段树语义。

资源声明安全预扫描只进入已知会承载 Schema 的位置：独立 JSON Schema 根、OAS Schema Object、
Draft 2020-12 已知 subschema applicator，以及带版本标记的 Knife4j 可移植资源容器。未知关键字、example 或 extension
的普通数据保持 opaque；其中的 `$id`、`$anchor`、`$dynamicAnchor`、`$schema`、`$vocabulary`、`$ref` 与
`$dynamicRef` 会原样保留，但不参与资源身份、anchor、方言、vocabulary 或引用预算预扫描。

真正的 Schema 资源根显式选择不受支持的 `$schema` 或声明自定义 `$vocabulary` 时，仍会给出资源级不受支持方言诊断，
并阻止依赖完整 Schema 语义的动作；该诊断不会回退到近似方言或执行自定义词汇。预扫描边界的实现与回归证据见
[#743](https://github.com/songxychn/knife4j-next/pull/743)。

## 外部 Schema 资源

SchemaEngine 自身不发起网络请求。外部 `$ref`、`$dynamicRef` 和相关基址先由 React UI 的受控资源图加载，
再以不可变 registry 交给解析、验证、导出和指纹流程。

### 授权范围

- 默认拒绝全部外部资源；只有文档实际发现并展示的**精确 HTTP(S) URI**可以被授权。
- 临时授权只对当前文档世代有效；刷新、切换分组或文档变化后失效。
- “记住授权”绑定到入口文档的规范化检索 URI 与内容摘要；URI 会保留已解析的 Origin、应用路径与分组查询参数，不会变成主机级通配授权。
- 持久化记录只保存资源 URI 哈希、脱敏展示值与授权时间，不保存凭据；每份文档最多记住 128 项，序列化记录最多 128 KiB。
- 设置页的“重置全部本地数据”会撤销已记住的授权；“清理请求缓存”不会撤销资源授权。

### 请求与凭据

资源请求使用浏览器 CORS、`GET`、`credentials: omit`、禁止重定向、无 referrer、无缓存，且不携带
Knife4j Authorize、Cookie、全局参数或业务请求 Header。HTTPS 入口不能降级加载 HTTP 资源，URI 也不能包含 userinfo。

服务端必须返回 `200`、UTF-8，以及 JSON 或 YAML 媒体类型。跨域服务还必须显式允许当前文档页 Origin。

### 固定预算

| 预算 | 上限 |
| --- | --- |
| 单资源解码后大小 | 4 MiB |
| 全部资源解码后大小 | 16 MiB |
| 外部文档数 | 64 |
| 引用数 | 10,000 |
| 引用深度 | 32 |
| 单文档解析节点 | 100,000 |
| 全图解析节点 | 250,000 |
| Schema 资源数 | 1,000 |
| 并发请求 | 4 |
| 单请求超时 | 10 秒 |
| 一轮加载总时长 | 30 秒 |
| 显式重试 | 每个资源 1 次 |
| YAML alias | 100 |

未授权、CORS、媒体类型、解析、重定向、超时或预算失败都会变成结构化、脱敏的资源诊断。
任何依赖完整闭包的动作都会保持不可用，不会偷偷回退到缺引用的结果；文档浏览仍可显示已加载内容和诊断。

## 浏览器调试边界

OpenAPI 能表达某项契约，不代表浏览器 JavaScript 能安全地发送它。

| 场景 | 文档展示 | 浏览器调试 |
| --- | --- | --- |
| `TRACE` | OAS 3.1 Path Item 可展示 | Fetch 禁止发送 |
| `CONNECT` / `TRACK` | 仅兼容输入到达调试器时展示 | Fetch 禁止发送；它们不是 OAS 3.1 Path Item 固定字段 |
| `GET` / `HEAD` request body | Schema、示例和 cURL 可展示 | Fetch 禁止带 body |
| 显式 Cookie 参数 | Schema 验证、序列化预览和 cURL 可展示 | 浏览器禁止脚本设置 `Cookie` Header，真实发送前阻断 |
| Webhook | 展示、字段树、离线文档和完整闭包下的单操作导出 | 仅描述入站回调，不从文档页主动发送 |
| `mutualTLS` | 识别并展示安全方案 | UI 不存储或注入客户端证书；应在浏览器、操作系统或受信代理配置 |
| 跨域 Schema | 已授权资源可参与解析 | 仍受 CORS 和上述无凭据策略限制 |
| 负向测试 | 可显式忽略当前请求 Schema 诊断 | 只跳过 Schema 阻断，不绕过 Fetch、鉴权或资源策略 |

这些边界由 [浏览器请求限制测试](https://github.com/songxychn/knife4j-next/blob/master/front/ui-react/src/pages/api/browserRequestConstraints.test.ts)、
文档对象 [#717](https://github.com/songxychn/knife4j-next/pull/717)、请求诊断
[#696](https://github.com/songxychn/knife4j-next/pull/696) 与资源安全
[#727](https://github.com/songxychn/knife4j-next/pull/727) 固化。

## 从 OpenAPI 3.0 迁移

迁移时应让生成器真正输出 3.1 文档，并逐项检查下列语义，不要只替换 `openapi` 版本号。

### `nullable` 改为类型联合

```yaml
# OpenAPI 3.0
type: string
nullable: true

# OpenAPI 3.1
type: [string, "null"]
```

### 布尔 Schema

```yaml
# 接受任意实例
schema: true

# 拒绝任意实例
schema: false
```

布尔 Schema 是完整 Schema，不能当成缺失 Schema。

### `example`、`examples` 与 `const`

```yaml
# OpenAPI 3.0 Schema
type: string
enum: [stable]
example: stable

# OpenAPI 3.1 Schema
type: string
const: stable
examples: [stable]
```

Media Type、Parameter 等 OpenAPI 对象仍可能使用自身的 `example` / `examples` 字段；不要把不同对象层级机械合并。

### `$ref` 同级关键字

```yaml
# OpenAPI 3.0 Schema 常用包装
allOf:
  - $ref: "#/components/schemas/User"
maxLength: 64

# OpenAPI 3.1 Schema 可以直接组合
$ref: "#/components/schemas/User"
maxLength: 64
```

这里说的是 **Schema Object**。OAS 3.1 的 **Reference Object** 只定义 `summary` 与 `description` 两个可用同级字段，
其他同级字段不会被当作目标对象补丁。

### 原始二进制与编码字符串

```yaml
# OpenAPI 3.0 常见原始二进制响应
content:
  application/octet-stream:
    schema:
      type: string
      format: binary

# OpenAPI 3.1 原始二进制响应
content:
  image/png:
    schema:
      contentMediaType: image/png

# OpenAPI 3.1：JSON 字符串里承载 base64，不是原始 body
schema:
  type: string
  contentEncoding: base64
  contentMediaType: image/png
```

Knife4j 也保留对生成器仍输出 `type: string` + `format: binary` 的兼容显示；`contentEncoding` 表示编码后的字符串，
不能被解释成浏览器文件对象或原始上传体。

### Webhook 与双向 TLS

```yaml
webhooks:
  paymentSettled:
    post:
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/PaymentEvent"
      responses:
        "204":
          description: Callback accepted
components:
  securitySchemes:
    ClientCertificate:
      type: mutualTLS
```

Webhook 描述的是 API 提供方向调用调用方的入站契约；它不是普通 `paths` 请求。`mutualTLS` 只声明安全方案，
客户端证书仍由浏览器、操作系统或受信代理持有。

## 最小有效夹具

仓库提供语义等价、可直接下载的两个最小文档：

- [OpenAPI 3.1 JSON](/examples/openapi-3.1-minimal.json)
- [OpenAPI 3.1 YAML](/examples/openapi-3.1-minimal.yaml)

它们包含 OAS 3.1 Base Dialect、`const`、可空类型联合和 Media Type `examples`，可用于验证加载、字段树、示例与响应诊断。

## 语言与诊断一致性

本页与 [English contract](./openapi31-en) 使用同一版本、能力、安全和迁移边界。React UI 的现有 OAS 3.1
诊断键在中文、英文和日文 locale 中保持同集；[locale 一致性测试](https://github.com/songxychn/knife4j-next/blob/master/front/ui-react/src/locales/locales.test.ts)
会拒绝缺失键、空翻译或插值变量不一致。切换语言不会改变诊断代码或放宽策略。

## 规范与实现证据

- [OpenAPI Specification 3.1.2](https://spec.openapis.org/oas/v3.1.2.html)
- [OpenAPI 3.1 Schema 与 Base Dialect](https://spec.openapis.org/oas/)
- [JSON Schema Draft 2020-12 Core](https://json-schema.org/draft/2020-12/json-schema-core)
- [JSON Schema Draft 2020-12 Validation](https://json-schema.org/draft/2020-12/json-schema-validation)
- [springdoc-openapi 属性说明](https://springdoc.org/properties)
- [Knife4j Next OAS 3.1 端到端矩阵 PR #737](https://github.com/songxychn/knife4j-next/pull/737)
