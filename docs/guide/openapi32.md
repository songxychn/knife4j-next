---
title: OpenAPI 3.2 支持与迁移
description: Knife4j Next 对 OpenAPI 3.2.x 的未发布支持矩阵、回归表、宿主承载、浏览器限制与迁移说明。
---

# OpenAPI 3.2 支持与迁移

[English contract](./openapi32-en) · [下载最小 JSON](/examples/openapi-3.2-minimal.json) · [下载最小 YAML](/examples/openapi-3.2-minimal.yaml)

::: warning 未发布
本文描述集成分支 `integration/oas32` 上的 OpenAPI 3.2.x 消费能力，**不是**已发布 Java `5.6.0` 或 Knife4x Go `v0.7.0` 的承诺。维护者将集成分支合入 `master` 并另行发版之前，不要把它写成当前发行版已经支持 3.2。
:::

已发布的 OpenAPI 3.0.x / 3.1.x 契约不变，见 [OpenAPI 3.1 支持与迁移](./openapi31)。Vue3 UI 继续只维护 OAS2。本文不改变任何 starter 默认配置，也不升级 springdoc 或 Java 生产依赖。

## 支持范围

OpenAPI 的功能集由 `major.minor` 定义。`3.2.x` 使用同一套 **OpenAPI 3.2 feature set**，不按 patch 拆分能力。3.2 文档走独立解析、资源图、Schema 会话、导出与变化跟踪，不降级成 3.1。

| 文档版本 | UI | 状态 | 说明 |
| --- | --- | --- | --- |
| Swagger / OpenAPI 2.0 | Vue 3 | 兼容维护 | 不扩展 OAS 3 能力 |
| OpenAPI 3.0.x | React | 已发布支持 | Java `5.6.0` / Go `v0.7.0` |
| OpenAPI 3.1.x | React | 已发布支持 | Java `5.6.0` / Go `v0.7.0` |
| OpenAPI 3.2.x | React | **未发布**（集成分支） | 合法 3.2 文档完整消费；不把 3.2 当 3.1 处理 |

## 规范夹具与生成器输出

Java 生产依赖仍为 springdoc `1.8.0` / `2.8.9` / Boot4 `3.0.3`。它们当前生成 OpenAPI 3.0.x 或 3.1.x。把 `/v3/api-docs` 里的 `openapi` 改成 `3.2.0` **不能**当作真实 3.2 生成证据，也不构成本路线的 Java 生成验收。

| 来源 | 实际输出 | 本路线用法 |
| --- | --- | --- |
| Boot 2.x + springdoc `1.8.0` | OpenAPI 3.0.x | 3.0 回归 |
| Boot 3.x / 4.x + springdoc `2.8.9` / `3.0.3` | OpenAPI 3.1.x | 3.1 回归 |
| 手写规范夹具 | OpenAPI 3.2.0 | 3.2 展示、调试、导出、变化跟踪与宿主承载 |

3.2 最小夹具与宿主夹具明确标注来源。Java 若要真实生成 3.2，需要维护者单独决定是否升级生产依赖。

## 产品能力矩阵

除非行内另有说明，“支持”指集成分支上的完整 3.2.x feature set。

| 能力 | OAS 3.2 行为 | 边界 | 合入证据 |
| --- | --- | --- | --- |
| 版本与标准方法 | 同一 minor feature set；QUERY 为 Path Item 固定字段 | 不维护 patch 白名单 | [#768](https://github.com/songxychn/knife4j-next/issues/768) / [#784](https://github.com/songxychn/knife4j-next/pull/784) |
| 文档结构与诊断 | 保留 3.2 对象、`additionalOperations`、结构诊断 | 非规范输入拒绝，不改写成 3.1 | [#769](https://github.com/songxychn/knife4j-next/issues/769) / [#785](https://github.com/songxychn/knife4j-next/pull/785) |
| 资源图 | `$self`、跨文档引用、受控加载 | 默认拒绝外部资源；指纹/导出不主动联网 | [#770](https://github.com/songxychn/knife4j-next/issues/770) / [#787](https://github.com/songxychn/knife4j-next/pull/787) |
| SchemaEngine | 官方 3.2 方言与 JSON Schema 2020-12 | 未知方言不回退成 3.1 | [#771](https://github.com/songxychn/knife4j-next/issues/771) / [#788](https://github.com/songxychn/knife4j-next/pull/788) |
| QUERY / 自定义方法 | QUERY 与 `COPY`/`Copy` 等大小写保留 | TRACE/CONNECT/TRACK 仍被 Fetch 禁止 | [#772](https://github.com/songxychn/knife4j-next/issues/772) / [#789](https://github.com/songxychn/knife4j-next/pull/789) |
| Tags / Server / Response | 层级 tags、server `name`、response `summary` | | [#773](https://github.com/songxychn/knife4j-next/issues/773) / [#791](https://github.com/songxychn/knife4j-next/pull/791) |
| 示例 | `dataValue` / `serializedValue` 与既有 `value` | 不是通用 JSON Schema 求解器 | [#774](https://github.com/songxychn/knife4j-next/issues/774) / [#790](https://github.com/songxychn/knife4j-next/pull/790) |
| `discriminator.defaultMapping` | 判别属性可选时的默认映射提示 | 不改变 JSON Schema 验证结果 | [#775](https://github.com/songxychn/knife4j-next/issues/775) / [#795](https://github.com/songxychn/knife4j-next/pull/795) |
| XML `nodeType` | | | [#776](https://github.com/songxychn/knife4j-next/issues/776) / [#797](https://github.com/songxychn/knife4j-next/pull/797) |
| querystring / Cookie style | querystring 使用 `content`，不能与有效 query 参数混用 | Cookie 仅预览/cURL，真实发送前阻断 | [#777](https://github.com/songxychn/knife4j-next/issues/777) / [#793](https://github.com/songxychn/knife4j-next/pull/793) |
| Multipart 位置编码 | | 不读取上传文件字节 | [#778](https://github.com/songxychn/knife4j-next/issues/778) / [#796](https://github.com/songxychn/knife4j-next/pull/796) |
| 顺序媒体 | SSE、JSONL/NDJSON、JSON-seq、multipart | 未知媒体保留原始内容并给出 codec 诊断 | [#779](https://github.com/songxychn/knife4j-next/issues/779) / [#799](https://github.com/songxychn/knife4j-next/pull/799) |
| 安全方案 | URI 引用与 Device Authorization | 不注入客户端证书，不主动发 Webhook | [#780](https://github.com/songxychn/knife4j-next/issues/780) / [#801](https://github.com/songxychn/knife4j-next/pull/801) |
| 单接口导出 | 完整资源图下的 3.2 闭包 | 3.1 导出器拒绝 3.2 文档 | [#781](https://github.com/songxychn/knife4j-next/issues/781) / [#802](https://github.com/songxychn/knife4j-next/pull/802) |
| 变化跟踪 | 独立协议 `oas3.2-v1` | 与 3.0 / 3.1 基线隔离；只跟踪 `paths` | [#766](https://github.com/songxychn/knife4j-next/issues/766) / [#803](https://github.com/songxychn/knife4j-next/pull/803) |
| 离线文档 | 独立 3.2 HTML / Markdown / Word 快照 | 3.1 快照拒绝 3.2 | [#782](https://github.com/songxychn/knife4j-next/issues/782) / [#804](https://github.com/songxychn/knife4j-next/pull/804) |
| 宿主承载 | WebJar `doc.html`、聚合 disk、Knife4x SpecURL | 3.2 使用规范夹具，不伪装 springdoc 输出 | [#783](https://github.com/songxychn/knife4j-next/issues/783) |

Schema 方言：

```yaml
jsonSchemaDialect: https://spec.openapis.org/oas/3.2/dialect/2025-09-17
```

显式写出官方 3.2 方言时按该 URI 执行。根级 `jsonSchemaDialect` **省略**时，SchemaEngine 按 OpenAPI 正文默认使用 `https://spec.openapis.org/oas/3.1/dialect/base`，不会改写成 3.2 方言。`https://spec.openapis.org/oas/3.2/dialect/base` 与其它未登记 URI 会报 `UNSUPPORTED_DIALECT`，不会静默当成 3.1。SchemaEngine 还执行 `https://json-schema.org/draft/2020-12/schema`。

## 3.0 / 3.1 / 3.2 回归矩阵

| 主题 | 3.0.x | 3.1.x | 3.2.x（未发布） |
| --- | --- | --- | --- |
| 入口版本 | 既有 3.0 路径 | 既有 3.1 路径 | 独立 3.2 路径，不降级 |
| 标准方法 | 无 QUERY 固定字段 | 同 3.0 | Path Item 增加 `query` |
| 自定义方法 | 无 `additionalOperations` | 无 | 保留大小写；保留方法不可放入该对象 |
| `query` 字段出现在 3.1 文档 | — | 忽略，不当成 QUERY | 作为 QUERY 操作 |
| Schema 方言 | OAS 3.0 Schema | `oas/3.1/dialect/base` | 显式 `oas/3.2/dialect/2025-09-17`；省略则回落 `oas/3.1/dialect/base` |
| 示例 | `value` / `externalValue` | 同左并含 JSON Schema `examples` | 增加 `dataValue` / `serializedValue` |
| 变化跟踪 | `oas3.0-v1` | `oas3.1-v1` | `oas3.2-v1` |
| 离线导出 | 3.0 快照 | 3.1 快照拒绝 3.2 | 3.2 快照拒绝 3.1 |
| 生成器 | springdoc 1.8.0 → 3.0 | springdoc 2.8.9 / 3.0.3 → 3.1 | 无当前生产生成器；只用规范夹具 |
| 失败路径 | OAS2 仍由 Vue3 处理 | 未知方言/资源失败保持不可用 | querystring 与 query 混用等结构错误给出诊断 |

可执行矩阵见 `front/ui-react/src/schema/oas32HostAcceptanceMatrix.test.ts`，并保留既有 3.0/3.1 测试。

## 浏览器限制

OpenAPI 能表达的契约，不等于浏览器 JavaScript 都能发送。

| 场景 | 文档展示 | 浏览器调试 |
| --- | --- | --- |
| QUERY / COPY | 展示并保留方法拼写 | Fetch 可发送（仍受 CORS）；离线导出仍可能标注 `BROWSER_EXECUTION_UNSUPPORTED` |
| TRACE / CONNECT / TRACK | 可展示 | Fetch 禁止发送 |
| 显式 Cookie 参数 | 预览与 cURL | 真实发送前阻断 |
| GET / HEAD 带 body | Schema / 示例 / cURL | Fetch 禁止带 body |
| Webhook | 展示、导出 | 不从文档页主动发送 |
| `mutualTLS` | 展示安全方案 | 不注入客户端证书 |
| 未知顺序媒体 | 保留原始内容 + codec 诊断 | 不假装已解码 |
| 外部 `$ref` / `$self` / OAuth metadata URL | 显示位置 | 默认拒绝；需对发现的精确 URI 授权，且不授予自动联网 |

## 宿主入口

集成分支上的 React WebJar、starter、聚合 disk 与 Knife4x 可以**承载**合法 3.2 JSON：

- `GET /doc.html` 仍返回 `webjars/knife4j-ui-react/`。
- starter 的真实 `/v3/api-docs` 仍是当前 springdoc 的 3.0/3.1 输出；smoke 通过独立的 `/synthetic/oas32.json` 提供规范夹具，不改生成器版本字符串。
- 聚合 disk 可同时挂 OpenAPI 3.1 文档和标注来源的 3.2 规范夹具；`swagger-instance` 原样返回文件内容。disk 路由的 `swagger-version` 仍写 `"3.0"`（相对 Swagger 2 的 OpenAPI 3 家族标签），不要把它改成 `"3.2"` 冒充新的已发布配置项。
- Knife4x `NewHandler` 只校验 SpecURL 为 HTTP(S)，不解析 OpenAPI 版本；嵌入 UI 加载 3.2 JSON，并拒绝 Swagger 2。入口仍不接受 YAML。

可见 UI 的无头验收：

```bash
node front/ui-react/scripts/run-oas32-host-acceptance.mjs
```

该脚本只监听 `127.0.0.1`，使用仓库内规范夹具与已嵌入的 React 资源，不访问真实第三方凭据或 PII 服务。

## 从 OpenAPI 3.1 迁移

让文档真正成为 3.2，不要只改版本字符串。

### QUERY 与自定义方法

```yaml
paths:
  /health:
    get:
      summary: Read
    query:
      summary: Query
    additionalOperations:
      COPY:
        summary: Copy
```

3.1 文档里名为 `query` 的字段不会被当成 QUERY。`GET`、`QUERY`、`POST` 等标准方法不能放进 `additionalOperations`。

### querystring 不能与 query 混用

```yaml
# 合法：QUERY 只使用 querystring
parameters:
  - name: filter
    in: querystring
    content:
      application/json:
        schema:
          type: object

# 非法：同一有效参数集同时出现 query 与 querystring
```

### 示例字段

```yaml
# OpenAPI 3.1 Media Type
examples:
  healthy:
    value:
      status: ok

# OpenAPI 3.2
examples:
  healthy:
    dataValue:
      status: ok
```

`value` 与 `dataValue` / `serializedValue` / `externalValue` 互斥。

### 方言

未声明 `jsonSchemaDialect` 时，3.2 文档仍使用正文默认 `https://spec.openapis.org/oas/3.1/dialect/base`。要按 3.2 方言执行，须显式写出 `https://spec.openapis.org/oas/3.2/dialect/2025-09-17`。未知方言（含 `oas/3.2/dialect/base`）会被拒绝，不会默认为 3.1。

## 最小有效夹具

- [OpenAPI 3.2 JSON](/examples/openapi-3.2-minimal.json)
- [OpenAPI 3.2 YAML](/examples/openapi-3.2-minimal.yaml)

它们包含 3.2 方言、QUERY、COPY、`const`、可空联合、SSE `itemSchema` 与 `dataValue` 示例。更完整的宿主夹具在 `front/ui-react/src/test-fixtures/oas32-normative/`。

## 规范依据

- [OpenAPI Specification 3.2.0](https://spec.openapis.org/oas/v3.2.0.html)
- [OAS 3.2 官方发布说明](https://github.com/OAI/OpenAPI-Specification/releases/tag/3.2.0)
- [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12)
- [总路线 #767](https://github.com/songxychn/knife4j-next/issues/767)
