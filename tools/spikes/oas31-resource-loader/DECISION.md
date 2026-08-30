# OAS 3.1 跨文档资源加载安全契约

- 状态：候选契约已冻结，等待维护者架构与安全审查
- 日期：2026-08-30
- 任务：[issue #704](https://github.com/songxychn/knife4j-next/issues/704)
- 前置：[issue #685](https://github.com/songxychn/knife4j-next/issues/685)、
  [issue #688](https://github.com/songxychn/knife4j-next/issues/688)
- 后续实现：[issue #705](https://github.com/songxychn/knife4j-next/issues/705)

## 1. 结论

后续 #705 可以实现一个 **显式授权、先加载完整文档、再注册内存资源图** 的浏览器
loader，但必须保持以下边界：

1. 默认仍是 registry-only，任何同源或跨域外部资源都不自动加载。
2. 用户只授权当前已发现的**精确 retrieval URI**；不提供全局、origin 通配或路径前缀
   授权。
3. 所有请求固定 `credentials: "omit"`、`redirect: "error"`、
   `referrerPolicy: "no-referrer"`、`cache: "no-store"`、`mode: "cors"`；同源也不例外。
4. 只允许无 URL credentials 的 HTTP(S) GET；禁止 `file:`、`data:`、`blob:` 和
   HTTPS 页面到 HTTP 资源的降级。
5. Knife4j 不绕过页面 CSP、CORS、Private Network Access、TLS 或浏览器 mixed-content
   策略，不增加通用服务端代理。
6. 先完整读取并安全解析 JSON/YAML 文档，再根据 retrieval URI、嵌入 `$id`、fragment
   和相对引用规则建立资源索引；绝不只下载或解析 fragment。
7. loader 与 Hyperjump URI plugin 分离。loader 先产出不可变 `ResourceGraphSnapshot`，
   `SchemaDocumentSession` 再把已通过策略的文档注册到 SchemaEngine；Hyperjump 始终看不到
   fetch 能力。
8. 一个活动 group 只有一个资源图/SchemaEngine owner；同 group 的多个标签页共享它。
   切 group、换文档或卸载时取消旧请求并销毁该代所有缓存与 registry 状态。
9. 单接口导出、变化指纹和离线文档只能读取指定 generation 的已注册图；缺资源时显式
   不可用或降级，禁止自己再次联网。

此结论不改变当前生产行为。维护者没有在 PR/issue 明确批准前，#705 不得开始生产接入。

## 2. 规范依据

- OAS 3.1 的 feature set 不按补丁版本分叉；实现必须覆盖整个 3.1.x：
  [OAS 3.1.1 §4.1](https://spec.openapis.org/oas/v3.1.1.html#versions)。
- 多文档 OAD 的加载边由 Reference Object、Path Item `$ref`、Schema `$ref`、Link
  `operationRef` 和 discriminator URI mapping 构成：
  [§4.3](https://spec.openapis.org/oas/v3.1.1.html#openapi-description-structure)。
- Schema target 判定前必须解析完整文档；fragment-only 解析会漏掉改变 base URI 的关键字，
  规范明确指出这会引入安全风险：
  [§4.3.1](https://spec.openapis.org/oas/v3.1.1.html#parsing-documents)。
- 非 Schema URI 通常以 referring document 的 base URI 解析；Schema 内使用最近 `$id`；
  JSON/YAML fragment 应按 JSON Pointer 解释：
  [§4.6](https://spec.openapis.org/oas/v3.1.1.html#relative-references-in-api-description-uris)。
- `$id` 是 canonical identifier，不保证可下载；它本身不能触发网络请求：
  [JSON Schema 2020-12 Core §8.2.1](https://json-schema.org/draft/2020-12/json-schema-core.html#name-the-id-keyword)。
- retrieval location 决定未声明 `$id` 时的初始 base；同一 URI 不能由多个 Schema 争用：
  [Core §9.1](https://json-schema.org/draft/2020-12/json-schema-core.html#section-9.1)。
- OAS 明确警告外部资源可能来自不可信域，并要求检测引用循环：
  [§5.4](https://spec.openapis.org/oas/v3.1.1.html#handling-external-resources)、
  [§5.5](https://spec.openapis.org/oas/v3.1.1.html#handling-reference-cycles)。
- Fetch credentials 包含 Cookie、HTTP authentication entry 和 TLS client certificate；
  `credentials: "omit"` 是这里的零 ambient authority 边界：
  [Fetch Standard](https://fetch.spec.whatwg.org/#credentials)。
- `connect-src` 在 fetch 前后均可阻断请求，产品授权不能放宽宿主页面 CSP：
  [CSP3 `connect-src`](https://w3c.github.io/webappsec-csp/#directive-connect-src)。
- `no-referrer` 要求完全省略 Referer：
  [Referrer Policy §3.1](https://w3c.github.io/webappsec-referrer-policy/#referrer-policy-no-referrer)。
- YAML 正式媒体类型为 `application/yaml`，`+yaml` 已注册；旧名称是 deprecated alias；
  YAML 还需要防御 tag 执行、alias 循环和指数展开：
  [RFC 9512](https://www.rfc-editor.org/rfc/rfc9512.html)。

## 3. 威胁模型

### 3.1 受保护资产

- 页面 Cookie、HTTP auth、TLS client certificate、Knife4j Authorization 配置和 referrer。
- 用户浏览器可达的内网/loopback 服务与私有地址。
- 原始 entry document 及其 retrieval URI/base URI 语义。
- Hyperjump realm-global registry、compiled cache 和当前 group 的隔离。
- 浏览器 CPU、内存、连接数、网络流量和 UI 可响应性。
- 用户对“这次加载了哪些 URL”的可审计意图。

### 3.2 攻击者可控输入

- entry/外部文档中的所有 URI、fragment、`$id`、引用数量、图深度和循环。
- 目标服务器的状态码、CORS、redirect、Content-Type、Content-Length、压缩体与响应速度。
- JSON/YAML 内容，包括重复键、深嵌套、alias、tag、循环和超大字符串。
- group/document 在请求进行中切换造成的竞态。

### 3.3 威胁与控制

| 威胁 | 控制 | 剩余风险/说明 |
|---|---|---|
| Cookie/Authorization/referrer 泄露 | `credentials: omit`；不复用 AuthContext；不设置 Authorization/Cookie；`no-referrer`；拒绝 URL userinfo | 浏览器仍会发送 User-Agent、Origin、Sec-Fetch、Accept-Encoding 等不可移除元数据 |
| 浏览器端 SSRF/内网探测 | 默认零请求；精确 URL 人工授权；仅 GET；CORS/CSP/PNA 保持生效；无代理 | 授权后的跨域 GET 即使 CORS 失败也会到达服务端；UI 必须明确警告这一点 |
| redirect 把授权转移到新目标 | `redirect: error`，不跟随任何 3xx | 浏览器通常只返回不透明 fetch 失败，无法稳定报告具体 Location |
| mixed content | HTTPS 页面预检拒绝所有 HTTP target，浏览器策略作为第二道门 | HTTP 页面仍可加载显式授权的 HTTP/HTTPS 资源 |
| DNS rebinding/地址变化 | 精确 scheme/host/port/URL 授权；保留 CORS/PNA/TLS；不做服务端解析 | 浏览器无法可靠 pin DNS/IP；批准 hostname 不是对某个 IP 的批准 |
| 响应/解压炸弹 | decoded stream 单资源/总字节上限；Content-Length 只作早拒绝；超限立即 cancel | 请求头声明值可能不真实，硬边界以实际解码字节为准 |
| YAML 代码执行/alias 炸弹 | safe parser；YAML 1.2 JSON schema；禁 custom tag/merge；alias 数、节点数、深度上限；拒绝多文档 stream | 解析器版本必须固定并在 #705 加恶意夹具 |
| 引用循环与组合爆炸 | URI 去重、祖先边记录、资源/引用/深度预算；SchemaEngine 继续执行自身求值预算 | 图循环不是错误；预算超限才是失败 |
| `$id`/registry 污染 | retrieval URI 与 canonical resource URI 分开；重复 URI 冲突；一代一 owner；失败后重建 | 不允许 last-write-wins 或静默换 base |
| 缓存跨 group 污染 | `cache: no-store`；body/parsed/失败缓存只在当前 generation 内；不持久化正文 | 浏览器/中间网络层仍可能有其自身不可见行为，应用不依赖它 |
| stale async 回写 | group/document/grant/retry 都生成新 generation；共享 AbortController；commit 前比对 generation | 已发出的 GET 无法撤回，取消只阻止继续消费/提交 |

## 4. 哪些 URI 进入资源图

发现器必须是 OAS/JSON Schema **上下文感知 walker**，不得对任意对象做“字段名像 URL 就
抓取”的字符串扫描。

| 来源 | 进入资源图 | 规则 |
|---|---:|---|
| Reference Object `$ref` | 是 | 按 source context 记录期望 target Object 类型；本地 fragment 不联网 |
| Path Item Object `$ref` | 是 | 覆盖 `paths`、`webhooks`、callbacks 和 `components.pathItems` 中的 Path Item |
| Schema `$ref` | 是 | 按最近 Schema Resource `$id` 或 document base 解析 |
| Schema `$dynamicRef` | 是 | 加载文档边与 `$ref` 相同；动态作用域求值仍交给 SchemaEngine |
| Link Object `operationRef` | 是 | 仅用于定位已加载 OAD 中的 Operation，不执行 linked operation |
| Discriminator `mapping` URI 形式 | 是 | absolute URI 或明确相对 URI；符合 component name 语法的裸值按名称处理，不猜成 URL |
| `$id`、`$anchor`、`$dynamicAnchor` | 否 | 只声明 base/canonical/fragment identifier；`$id` 不保证是 locator |
| `$schema`、`jsonSchemaDialect`、`$vocabulary` | 否 | 只匹配内置且已支持的 dialect/vocabulary；未知项诊断，不下载/执行 |
| Link `operationId`、Security Requirement 名称、tags | 否 | 解析已加载文档中的 implicit connection，不因名称主动找文档 |
| `externalDocs.url`、terms/contact/license URI | 否 | 仅保留为用户点击的链接 |
| Server URL、OAuth endpoint、XML namespace | 否 | 属于 API/认证/表示语义，不是 OAD 资源加载边 |
| Example Object `externalValue` | 否 | 保留原值/链接；示例下载不是本 loader 职责 |
| Markdown 链接与图片 | 否 | 由 Markdown 渲染/消毒策略处理，不能借资源图获得网络权限 |
| `$comment` 或未知 keyword 中的 URL-like string | 否 | 原文保留；未知 vocabulary 不执行、不推断 schema 位置 |

对标准 Draft 2020-12/OAS dialect，Schema walker 只沿已知会包含 subschema 的关键词下降。
未知 vocabulary 的关键词保留为 annotation，不扫描其中潜在 `$ref`；要支持新 vocabulary 必须
另行冻结语义和安全边界。

## 5. URI、完整文档与解析顺序

每条引用按以下顺序处理：

1. walker 记录 `sourceRetrievalUri`、`sourcePointer`、引用种类、原始值和当时的 Schema base。
2. 用 RFC 3986 解析绝对 URI。Schema 引用使用最近 `$id`；其他 OAS Object 使用 referring
   document base。
3. 将 fragment 与 document URI 分离。授权、请求、去重和字节预算只针对无 fragment 的
   retrieval URI；同 URI 的多个 fragment 只请求一次。
4. 执行 scheme、userinfo、mixed-content、精确 grant 和全局预算预检；通过前不得调用
   `fetch`。
5. GET 完整响应并按 decoded bytes 流式限额；只接受 HTTP 200，拒绝 206 等非完整表示。
6. 根据 Content-Type 选择 JSON/YAML safe parser；解析完整且唯一的 document，先做结构预算
   和重复 identifier 冲突检查。
7. retrieval URI 是 document 的初始 base；Schema Resource 内的合法 `$id` 再建立 canonical
   URI/embedded resource 索引。`$id` 只加关联，不覆盖 retrieval URI，也不触发第二次网络请求。
8. 完整索引建立后才解析 JSON Pointer、plain-name anchor 或 dynamic anchor fragment，并校验
   target 与 source context 期望的 Object 类型。
9. 新引用进入下一轮 `pending`；未获授权则停止该边，不把错误 base 下的结果当成功。

JSON/YAML fragment 按 OAS 建议使用 JSON Pointer。Schema plain-name anchor/dynamic anchor 由
SchemaEngine 处理。YAML alias fragment（`#*name`）不纳入 OAS 3.1 产品契约；文档需要可映射到
OAS 的 JSON 数据模型，作者应使用 JSON Pointer 或 Schema anchor。

### 5.1 Content-Type 与解析

- JSON：`application/json` 或 subtype 以 `+json` 结尾。
- YAML：`application/yaml` 或 subtype 以 `+yaml` 结尾。
- 兼容读取 `application/x-yaml`、`text/yaml`、`text/x-yaml`，同时产生
  `LEGACY_MEDIA_TYPE` warning；`Accept` 不主动广告这些旧别名。
- 缺失、`text/plain`、`application/octet-stream` 等一律拒绝，不按扩展名或首字符 sniff。
- body 必须是 UTF-8；JSON/YAML 必须完整消费，尾随第二文档或非空垃圾均失败。
- JSON/YAML object key 必须唯一且为 string；拒绝 custom tag、merge key、非有限数字和产生循环的
  alias 图。YAML 允许最多 100 个安全 alias 展开，并在转换后再次执行节点/深度预算。

请求 `Accept` 固定为：

```text
application/openapi+json, application/openapi+yaml, application/schema+json, application/json, application/yaml
```

该值 111 字节，保持 CORS-safelisted，不为简单 GET 引入 OPTIONS preflight。

## 6. 授权与 UI 契约

### 6.1 默认状态

- entry document 正常显示；原始对象不修改。
- 发现外部边后显示非阻断状态“有 N 个外部文档待授权”，不自动请求。
- 现有 registry-only 错误/横幅在 #705 完成前保持不变；本 spike 不改 UI。

### 6.2 审阅对话框

每个 pending resource 展示：

- 同源/跨域分类、scheme/host/port、去掉 fragment 的 path；query 只显示 `?…`，不显示值。
- 引用种类、首次 source pointer、引用次数和是否由已授权外部文档递归发现。
- 明示“授权会发送一个**无凭据 GET**；即使 CORS 最终拒绝，服务器仍可能收到请求”。
- 明示 CSP/CORS/TLS 仍可阻止读取，Knife4j 不会代理或绕过。

动作只有：

1. `本次加载所选资源`：给当前 generation 的所选精确 retrieval URI 内存 grant。
2. `对此文档记住所选资源`：持久化所选精确 URI 的 hash grant；不得扩成整个 origin/path。
3. `取消`：保持 pending，不请求。

新下载文档发现的新 URI 必须再次进入 pending；可批量选择当前列表，但不存在“递归全部允许”。

### 6.3 持久化边界

- `documentScope = SHA-256(normalized entry retrieval URI + entry content digest)`。
- `resourceKey = SHA-256(normalized exact retrieval URI)`。
- storage 只保存版本、documentScope、resourceKey、无 query 的安全显示标签和时间；不保存正文、
  完整 query、Cookie、失败 body 或 response header。
- entry 内容变化、group 切换到不同 scope、清理本地数据或策略版本升级都会失效。
- 包含 query 的 URI 可以一次授权；持久 grant 仍只保存 hash 和去 query 标签，绝不落明文 query。
- 不提供全局 grant、origin wildcard、path prefix 或 credentials grant。

## 7. HTTP 与浏览器策略

生产 fetch 参数固定如下，页面组件不能覆盖：

```ts
fetch(retrievalUri, {
  method: 'GET',
  mode: 'cors',
  credentials: 'omit',
  redirect: 'error',
  referrerPolicy: 'no-referrer',
  cache: 'no-store',
  headers: { Accept: SAFE_ACCEPT },
  signal,
})
```

- same-origin 不自动授权，也不发送 Cookie/HTTP auth/TLS client credentials。
- 不复用 `AuthContext`、global parameter、debug request headers 或页面当前 Authorization。
- cross-origin 服务器必须返回允许页面 origin 的 CORS header；因为 credentials 被 omit，
  `Access-Control-Allow-Origin: *` 可以工作。
- Knife4j 不使用 `no-cors` opaque response，因为无法安全读取/验证完整文档。
- 所有 3xx 都失败；不使用 `follow` 后比较 `response.url`，因为那时未授权 target 已收到请求。
- 宿主部署需在 `connect-src` 允许目标；产品 grant 不能修改 response CSP。
- HTTPS 页面主动拒绝 HTTP target，不依赖浏览器可能发生的 upgrade/例外。
- 不增加 `keepalive`、service worker 缓存或 background retry。

Fetch 对 CORS、CSP、redirect、TLS、DNS 和普通网络错误通常只给调用者一个不透明失败。因此稳定
诊断为 `RESOURCE_FETCH_BLOCKED`，并列出“可能由 CSP/CORS/redirect/TLS/network 导致”的操作建议；
不得从 message 文本猜具体安全机制。

## 8. 预算、取消、缓存与重试

以下是 #705 的默认硬上限；本期不提供用户 UI 放宽：

| 项目 | 上限 | 计数时机 |
|---|---:|---|
| 单外部响应 decoded bytes | 4 MiB | stream reader，Content-Length 只早拒绝 |
| 当前 generation 外部响应总 decoded bytes | 16 MiB | 包含最终解析失败的已读字节 |
| 外部 document 数 | 64 | 发请求前预留 slot；entry 不计网络数 |
| 发现的引用边 | 10,000 | walker 每遇到一个范围内引用字段 |
| 外部 document graph 深度 | 32 | entry 到外部 document 的边数 |
| 每 document 解析后节点数 | 100,000 | safe parse 后、注册前 |
| 当前图解析后总节点数 | 250,000 | commit 前 |
| 当前图 Schema Resource 数 | 1,000 | 包含嵌入 `$id` resource |
| 并发 GET | 4 | scheduler |
| 单 GET timeout | 10 s | headers + body 完整读取 |
| 一次 load wave 主动网络时间 | 30 s | 不含等待用户授权时间 |
| redirect | 0 | fetch 参数 |
| 自动 retry | 0 | 失败立即诊断 |
| 显式 retry | 每 URI/generation 1 次 | 初次 + 一次用户触发，共最多两次请求 |
| YAML alias | 100 | safe parser，随后仍执行节点预算 |

预算检查必须先于调度下一请求；并发任务共享 generation AbortController。任一总预算失败时取消
尚未完成的请求，保留 entry 原文和资源级诊断，但不把半成品图交给消费者。失败/取消已读取的
字节和请求次数仍计入该 generation，防止 retry 绕过预算。

缓存规则：

- exact retrieval URI 为 in-flight dedupe key，同 URI 不因 fragment 不同重复取。
- response body、parsed document、resource index 和失败状态只在当前 generation 内存中存在。
- 使用 `cache: no-store`，不建立 localStorage/IndexedDB/Service Worker body cache。
- 显式 retry 清除该 URI 的失败结果，但不重置总预算。
- group、entry retrieval URI、entry digest、grant set 或策略版本变化都会递增 generation；旧 promise
  完成后只丢弃，不能回写。

## 9. Realm-global registry 与所有权

采用如下所有权关系：

```text
GroupProvider (active group)
  -> ResourceGraphSessionManager (唯一 loader / generation owner)
     -> ResourceGraphSnapshot (不可变、无 fetch 方法)
        -> SchemaDocumentSession (唯一 Hyperjump owner)
           -> 同 group 的 Schema/ApiDoc/ApiDebug 多标签页只读消费
```

- loader 不安装 Hyperjump `http`/`https` URI scheme plugin；`SchemaEngine` 的每个 public operation
  继续重申 registry-only 锁定。
- fetch/parse 完成后先在 loader 层检查 URI 冲突和预算，再按稳定 retrieval URI 顺序注册所有
  document。注册失败则 dispose 该 engine，并用 entry-only 图恢复；不得保留未知的部分 registry。
- 同 group 标签页不拥有 session，不因单 tab 关闭而 unregister。
- group/document 切换先 abort loader，再 dispose engine，等待旧 owner 释放后创建下一代；沿用
  `SchemaDocumentSessionManager` 已有 revision/settled 串行化。
- 不在同一 JS realm 保留多个 group 的 Hyperjump owner。若未来确需后台并存，应以独立 Web Worker
  隔离 realm，另开 issue；#705 不引入 worker。

## 10. 失败 UI 与“没有静默换 base”的证据

entry 原始文档始终是只读真相源。loader 不 dereference-in-place、不覆盖 `$ref`、不把外部字段 merge
回原对象。

每条诊断至少包含：

```ts
interface ResourceDiagnostic {
  code: ResourceLoadErrorCode
  phase: 'discover' | 'authorize' | 'fetch' | 'read' | 'parse' | 'index' | 'register'
  sourceRetrievalUriHash: string
  sourcePointer: string
  referenceKind: ResourceReferenceKind
  rawReferenceDisplay: string       // query/userinfo 已遮盖
  resolutionBaseDisplay: string     // query 已遮盖
  targetRetrievalUriHash?: string
  resourceDisplay?: string
  limit?: number
  actual?: number
  generation: number
  retryable: boolean
}
```

资源面板同时展示 raw reference、实际 resolution base、计算出的 retrieval URI（安全展示）、
canonical `$id` 列表和 fragment target。若 `$id` 非法、冲突或改变 base 后 target 不存在，必须在
对应 phase 失败；禁止回退到 retrieval URI 下“再试一次”并把结果当成功。

顶层状态分为：

- `ready`：当前授权图全部解析/注册成功。
- `partial`：entry 可用，但有 pending/failed external edges；兼容视图可显示，依赖缺失资源的能力
  明确标记不可用。
- `failed`：entry 自身无法建立 session；仍展示原始文档和诊断。
- `cancelled/stale`：不对用户显示为错误，不允许回写当前代。

## 11. 生产接口草案

这些类型属于 Knife4j，不能泄露 Hyperjump/Playwright 类型：

```ts
type ResourceReferenceKind =
  | 'reference-object'
  | 'path-item-ref'
  | 'schema-ref'
  | 'schema-dynamic-ref'
  | 'link-operation-ref'
  | 'discriminator-mapping'

interface ResourceLoadLimits {
  maxResourceBytes: number
  maxTotalBytes: number
  maxDocuments: number
  maxReferences: number
  maxDepth: number
  maxParsedNodesPerDocument: number
  maxTotalParsedNodes: number
  maxSchemaResources: number
  maxConcurrency: number
  requestTimeoutMs: number
  waveTimeoutMs: number
  maxExplicitRetriesPerResource: number
}

interface ResourceCandidate {
  retrievalUri: string
  retrievalUriHash: string
  displayUri: string
  sameOrigin: boolean
  references: readonly {
    sourceDocumentUriHash: string
    sourcePointer: string
    kind: ResourceReferenceKind
    rawReferenceDisplay: string
    fragment: string
  }[]
}

interface ResourceGrant {
  scope: 'generation' | 'document'
  documentScope: string
  resourceKey: string
}

interface ResourceGraphNode {
  retrievalUri: string
  mediaType: string
  byteLength: number
  contentDigest: string
  documentKind: 'openapi' | 'json-schema' | 'referenceable-object'
  resourceUris: readonly string[]
  document: unknown
}

interface ResourceGraphEdge {
  sourceRetrievalUri: string
  sourcePointer: string
  kind: ResourceReferenceKind
  resolvedUri: string
  targetRetrievalUri: string
  fragment: string
  state: 'local' | 'pending' | 'loaded' | 'failed'
}

interface ResourceGraphSnapshot {
  generation: number
  entryRetrievalUri: string
  nodes: ReadonlyMap<string, ResourceGraphNode>
  edges: readonly ResourceGraphEdge[]
  diagnostics: readonly ResourceDiagnostic[]
  complete: boolean
}

interface ExternalResourceLoader {
  discover(entry: unknown, retrievalUri: string, signal?: AbortSignal): Promise<{
    generation: number
    candidates: readonly ResourceCandidate[]
    diagnostics: readonly ResourceDiagnostic[]
  }>
  load(grants: readonly ResourceGrant[], signal?: AbortSignal): Promise<ResourceGraphSnapshot>
  retry(retrievalUriHash: string, signal?: AbortSignal): Promise<ResourceGraphSnapshot>
  dispose(): void
}
```

`fetch`、parser、grant storage 和 clock 只允许通过内部构造参数注入以便测试；React context 只暴露
snapshot、pending candidates、`loadOnce`、`rememberAndLoad`、`retry` 和 `cancel`，不暴露任意 URL
fetch 或 registry mutation。

### 11.1 稳定错误码

| 错误码 | 含义 | retryable |
|---|---|---:|
| `RESOURCE_LOADING_DISABLED` | 默认策略尚未有任何 grant | 否，先授权 |
| `RESOURCE_NOT_AUTHORIZED` | exact URI 无 grant | 否，先授权 |
| `RESOURCE_URI_INVALID` | URI 无法按 base 解析 | 否 |
| `RESOURCE_URI_CREDENTIALS_FORBIDDEN` | URL 含 username/password | 否 |
| `RESOURCE_SCHEME_UNSUPPORTED` | 非 HTTP(S) | 否 |
| `RESOURCE_MIXED_CONTENT_BLOCKED` | HTTPS → HTTP | 否 |
| `RESOURCE_FETCH_BLOCKED` | CSP/CORS/redirect/TLS/network 的不透明失败 | 是 |
| `RESOURCE_HTTP_STATUS` | 非 HTTP 200（包括 206） | 仅 408、429、5xx 是 |
| `RESOURCE_CONTENT_TYPE_UNSUPPORTED` | 非允许 JSON/YAML type | 否，修服务端 |
| `LEGACY_MEDIA_TYPE` | YAML deprecated alias | warning |
| `RESOURCE_TOO_LARGE` | 单体或总字节超限 | 否 |
| `RESOURCE_ENCODING_UNSUPPORTED` | 非 UTF-8 | 否 |
| `RESOURCE_ABORTED` | 用户/生命周期取消 | 否 |
| `RESOURCE_TIMEOUT` | 请求或 wave 超时 | 是 |
| `DOCUMENT_PARSE_FAILED` | JSON/YAML 不完整或不安全 | 否 |
| `DOCUMENT_KIND_MISMATCH` | 完整文档/fragment 不是 source 期望类型 | 否 |
| `RESOURCE_URI_CONFLICT` | 多个 schema 争用 canonical URI | 否 |
| `FRAGMENT_NOT_FOUND` | 完整索引后 target 不存在 | 否 |
| `GRAPH_RESOURCE_LIMIT` | document 数超限 | 否 |
| `GRAPH_REFERENCE_LIMIT` | 引用边超限 | 否 |
| `GRAPH_DEPTH_LIMIT` | 外部图深度超限 | 否 |
| `GRAPH_NODE_LIMIT` | 解析节点超限 | 否 |
| `STALE_GENERATION` | 旧代完成结果被丢弃 | 否，不展示为错误 |

## 12. 下游消费者

- `SchemaDocumentSession` 接受一个已完成/部分完成 snapshot，注册其中已验证的 Schema document；
  `resolve/evaluate` 不得触发 loader。
- 单接口导出、变化指纹、离线文档接收 `{ graph, generation }` 参数。它们只能遍历 snapshot；
  generation 不匹配或 edge pending/failed 时返回结构化 unavailable 结果。
- 任何下游模块都不能持有 `ExternalResourceLoader`、grant store 或 `fetch`。
- bundling 的 target URI 重写、可移植导出和离线打包属于 #706/#708，不在 #705 loader 内实现。

## 13. 候选方案与拒绝理由

| 方案 | 结论 | 理由 |
|---|---|---|
| 受控浏览器 loader → immutable graph → registry | 采用 | 请求可审阅、预算可集中、Hyperjump 保持零网络能力、下游可证明不再次联网 |
| 恢复 Hyperjump HTTP/HTTPS URI plugin | 拒绝 | realm-global；请求由求值隐式触发；难做 UI grant、总预算、代际取消和完整 OAD Object 图 |
| same-origin 自动加载，cross-origin 才询问 | 拒绝 | same-origin 仍可能含 Cookie/内网权限或被恶意文档利用；权限承诺更宽且不必要 |
| 同源 `credentials: same-origin`，跨域 omit | 拒绝 | 会把页面 ambient authority 隐式授予外部资源；受保护 schema 另开明确认证方案 |
| 跟随 redirect 后检查最终 URL | 拒绝 | 检查时未授权 target 已收到请求；跨域 manual redirect 又是 opaque |
| `no-cors` 获取 opaque response | 拒绝 | 无法读取、限额、解析和验证文档 |
| 通用服务端代理 | 拒绝 | 引入服务端 SSRF、凭据、部署与审计边界，违反本 issue 停止条件 |
| origin/path wildcard 持久授权 | 拒绝 | 新增未展示 URL 可静默获得权限；exact hash grant 已足够批量操作当前候选 |
| 持久化 response body/parsed graph | 拒绝 | 跨 group 污染、过期与敏感 query/body 风险；重载成本受预算控制 |
| 每 group 一个 Web Worker/Hyperjump realm | 延后 | 可隔离多 owner，但当前产品只有 active group 需要 session；增加通信与生命周期复杂度 |
| 仅允许用户上传 bundle | 保留为未来补充 | 最安全离线入口，但不能满足合法 HTTP(S) 多文档 OAD 的交互目标 |

## 14. 浏览器探针证据

运行：

```bash
./tools/test-oas31-resource-loader-spike.sh
```

2026-08-30 本地结果：

- Bun 1.4.0；Headless Chrome 151.0.7922.174。
- 纯策略测试 8/8。
- 浏览器断言 10/10；服务端网络断言 6/6。
- 同源页面 Cookie 存在，但 loader 请求的 Cookie/Authorization/Referer 均不存在；响应
  `Set-Cookie` 也未被浏览器持久化。
- CORS 成功目标收到一个 GET；CORS 失败目标也收到一个无凭据 GET，页面只得到 opaque failure。
- CSP-blocked target 0 请求；redirect target 0 请求。
- slow stream 的服务端 `cancel()` 被触发。
- A → B → A 各请求一次；资源上限为 1 时 B 在调度前保持 0 请求。
- `Accept` 收敛到 111 字节后没有 OPTIONS preflight。

完整归一化预期清单见 [README.md](./README.md)。探针故意不把浏览器
`requestfailed` 当业务真相：CORS 拒绝、主动 abort、body cancel 都可能进入该事件；最终以页面稳定
错误码与 loopback 服务端实际请求记录交叉验证。

## 15. #705 测试矩阵

| 维度 | 必测案例 | 期望 |
|---|---|---|
| 默认策略 | 同源 `$ref`、跨域 `$ref` | 0 请求，pending |
| 精确 grant | 同 URL 不同 fragment | 一次请求，多 edge |
| grant 边界 | 未列出的同 origin URL | 0 请求，pending |
| URL | relative、absolute、query、percent encoding | RFC 3986 后 exact identity 稳定 |
| URL credentials | `https://u:p@host/` | 请求前拒绝 |
| scheme | file/data/blob/ftp | 请求前拒绝 |
| mixed content | HTTPS page → HTTP | 请求前拒绝 |
| request headers | same/cross origin | Cookie/Auth/Referer 为空，Accept 正确，无 preflight |
| CORS | allow exact origin、`*`、缺失、错误 origin | 前两者成功；后两者 opaque failure |
| CSP | connect-src 允许/拒绝 | 允许可继续；拒绝 0 服务端请求 |
| redirect | same/cross-origin 301/302/307/308 | source 一次，target 0，统一 fetch blocked |
| HTTP | 200、204、206、3xx、4xx、5xx | 只有 200 进入解析；其余按策略失败 |
| media type | json/+json/yaml/+yaml/legacy/unknown/missing | 注册类型成功；legacy warning；unknown/missing 拒绝 |
| encoding | UTF-8/BOM/invalid UTF-8 | 前两者成功；非法拒绝 |
| JSON | duplicate keys、trailing garbage、深对象、超大字符串 | 明确拒绝/预算错误，无 partial parse |
| YAML | single doc、multi-doc、custom tag、merge、alias cycle、billion laughs | 仅安全单文档成功 |
| complete parse | fragment 前有 root/embedded `$id` | 先索引完整文档，再按正确 base 定位 |
| `$id` | retrieval 不同于 root `$id` | 两个身份同时记录，不二次 fetch |
| URI conflict | 两文档相同 `$id` | 整代注册失败，无 last-write-wins |
| Reference Object | 外部完整 OAS、root referenceable object | 按 source context 验证 target 类型 |
| Path Item `$ref` | paths/webhooks/callback/components | 进入图，不发送 webhook/callback |
| Schema | `$ref`/`$dynamicRef`/anchor/embedded resource | 资源正确注册，动态求值交给 engine |
| Link | external `operationRef` | 加载后定位 Operation，不执行请求 |
| discriminator | absolute/`./relative`/bare component name | 前两者加载；裸名从 entry components 解析 |
| link-only URI | externalDocs/server/oauth/example externalValue | 0 loader 请求 |
| cycle | A→A、A→B→A、diamond | 去重、记录 cycle，不死循环 |
| document limit | 第 65 个 | 第 65 个请求前拒绝 |
| bytes | Content-Length 过大、chunked 超限、gzip bomb | 按 decoded bytes 取消，计入总预算 |
| references/depth/nodes | limit-1、limit、limit+1 | 前两者允许，最后一个调度/注册前拒绝 |
| concurrency | 大于 4 个 ready target | 同时在途不超过 4 |
| timeout/cancel | slow headers、slow body、group switch、用户 cancel | abort reader/fetch，旧代不回写 |
| retry | transient fail 后显式两次点击 | 只允许一次 retry，总预算不重置 |
| cache | 同 URI 多 edge、group switch、entry digest change | 当前代 dedupe；新代重新取，不复用 body |
| tabs/groups | 同 group 多 tab、切 group、快速来回切换 | 单 owner，共享只读图，无 registry 泄漏 |
| failure UI | pending/CORS/budget/conflict/fragment missing | 原始 entry 保留，资源级诊断含真实 base，无静默 fallback |
| downstream | export/fingerprint/offline with incomplete graph | 0 网络；结构化 unavailable/partial |

## 16. 审查门槛

维护者架构/安全审查需要明确确认或要求修改以下权限承诺：

1. 同源也默认关闭、也使用 `credentials: omit`。
2. 持久授权仅 exact URI hash，不支持 origin/path wildcard。
3. redirect 数为 0；不引入代理。
4. 上述默认预算和一次显式 retry。
5. active-group 单 owner；Web Worker 多 realm 延后。

任一项若要放宽，会改变外部权限承诺，必须回到 issue 决策，不能由 #705 实现或 review 评论隐式
扩张。审查通过后，#704 才能进入 `status:review`，#705 才能从 blocked 转 ready。
