# knife4x / go

Go module：

```text
github.com/songxychn/knife4j-next/knife4x/go
```

Knife4x 已发布版本消费 OpenAPI 3.0.x / 3.1.x / 3.2.x JSON 文档，不生成 spec，不支持 OAS2 / Swagger 2。核心只依赖
标准库 `net/http`；Gin 只是可运行的组合示例，不是库依赖。合法 3.2 JSON 可经 `SpecURL`
交给同一套 React UI；限制见
[OpenAPI 3.2 支持矩阵](../../docs/guide/openapi32.md)。

当前版本为 `v0.9.2`，对应仓库 tag `knife4x/go/v0.9.2`：

```bash
go get github.com/songxychn/knife4j-next/knife4x/go@v0.9.2
```

相较于 `v0.8.9`，单接口 Markdown 复制与完整文档导出共用字段、请求/响应和示例规则；不完整内容需确认并保留诊断。同步对象候选截断、千字段示例生成及 allOf 无类型字符串约束修复，保留作者示例、方向、授权资源图、取消与安全预算（PR #965/#967/#970/#975）。

Schema 会话改用同源 ES module Worker；部署须保留 Worker 和动态分块、允许相应 CSP 并提供正确 JavaScript MIME，失败有诊断。Go 内联配置仍按原有 CSP 方式授权。当前源码构建与 UI 同步使用稳定 Bun `1.4.x`（最低 `1.4.4`，CI 版本选择见根目录 `.bun-version`），无需 Node.js；直接使用 module 不需要 JavaScript 运行时。

公共库仍只依赖标准库；Go 1.22、module、`Config`、`NewHandler` 与路由语义不变，独立 Gin 示例仍需 Go 1.26+。浏览器沿用 `v0.8.9`，OpenAPI 3.0/3.1/3.2 JSON 消费与资源授权边界不变，仍不接受 YAML。

调试正文格式化与快照写入修复从 `v0.8.5` 起提供。OpenAPI 3.2.x 消费从 `v0.8.0`
起提供；JSON 示例与预览层级折叠、请求预览词法保真与空容器折叠从 `v0.8.4`
起提供；OAS 3.2 标签 Tooltip 重复名称、Schema 元校验错误定位、普通 JSON 示例默认展示与调试 JSON 响应折叠从 `v0.8.3`
起提供；OAS 3.2 标签菜单重复名称、首页服务地址明细默认折叠与窄窗口布局修复从 `v0.8.2`
起提供；OAS 3.1 SchemaEngine 元校验失败重试修复从 `v0.8.1`
起提供；OAS 3.1 非 ASCII 分组名下自引用 `$ref` 身份修复从 `v0.7.1`
起提供；浏览器登录会话调试、枚举输入过滤和目录分组吸顶从 `v0.7.0` 起提供；OAS 3.1、
JSON Schema 2020-12、受控资源加载、调试诊断、导出与变化提示从 `v0.6.0` 起提供；
OAS 3.0.x 继续沿用既有路径。版本明细见
[Go 版本说明](../../docs/knife4x/index.md)。

外部资源默认拒绝，须对已发现的精确 URI 授权；SchemaEngine 只使用已登记的资源，不自行联网。
不执行未知方言或自定义词汇，不提供 Cookie jar 写入、主动 Webhook 调用或客户端证书注入。
显式 Cookie 参数可预览或生成 cURL，浏览器真实发送前会阻断；完整边界见
[OpenAPI 3.1 支持与迁移](../../docs/guide/openapi31.md) 与
[OpenAPI 3.2 支持矩阵](../../docs/guide/openapi32.md)。

### v0.5.0（历史版本）

`v0.5.0` 保持 `Config`、`NewHandler` 与路由语义不变，内嵌 React UI 新增页签左右
关闭、响应状态概要、Knife4j 本地数据安全清理、单接口 OpenAPI 3.0.x 下载，以及按
分组隔离的接口新增/变化提示。

发布门禁、tag 规则与公共消费验证见 [RELEASE.md](RELEASE.md)。

## 标准库接入

先让业务 Handler 提供 OpenAPI 3 文档和 API，再把它作为 `next` 传给
`NewHandler`：

```go
package main

import (
	"log"
	"net/http"

	knife4x "github.com/songxychn/knife4j-next/knife4x/go"
)

func main() {
	app := http.NewServeMux()
	app.HandleFunc("/openapi.json", serveOpenAPI)
	app.HandleFunc("/api/ping", servePing)

	handler, err := knife4x.NewHandler(knife4x.Config{
		SpecURL: "/openapi.json",
	}, app)
	if err != nil {
		log.Fatal(err)
	}
	log.Fatal(http.ListenAndServe(":8080", handler))
}

func serveOpenAPI(w http.ResponseWriter, r *http.Request) {
	http.ServeFile(w, r, "./openapi.json")
}

func servePing(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"message":"pong"}`))
}
```

把顶层为 `openapi: 3.0.x`、`openapi: 3.1.x` 或 `openapi: 3.2.x` 的 JSON 保存为当前目录的 `openapi.json`。
`v0.9.2` 可加载合法 3.2 JSON。启动后打开
<http://localhost:8080/doc.html>。

已发布的 `v0.9.2` 使用以下两个配置字段；下文“当前源码新增配置”中的 API 尚未包含在该版本中：

| 字段 | 说明 |
|---|---|
| `SpecURL` | 必填；OpenAPI 3 文档 URL，可为根相对、相对或完整 HTTP(S) URL |
| `BasePath` | 可选；文档挂载前缀，空值等同于 `/` |

`BasePath: "/internal"` 时，文档入口为 `/internal/doc.html`，静态资源也位于
`/internal/` 下。它不是入口文件名，也不是业务 API base URL。相对
`SpecURL: "openapi.json"` 会解析到 `/internal/openapi.json`；根相对
`SpecURL: "/openapi.json"` 仍指向根路径。

未知路由会交给 `next`。生产环境需要关闭文档时，不创建或不挂载 Knife4x Handler；
宿主注册的 `/openapi.json` 也须单独停止注册，关闭 UI 不会关闭这个接口。

## Gin 接入

Gin engine 已实现 `http.Handler`，直接把它传给同一个 `NewHandler`：

```go
router := gin.New()
router.GET("/openapi.json", serveOpenAPI)
router.GET("/api/ping", servePing)

handler, err := knife4x.NewHandler(knife4x.Config{
	SpecURL: "/openapi.json",
}, router)
if err != nil {
	log.Fatal(err)
}
log.Fatal(http.ListenAndServe(":8080", handler))
```

完整可运行代码、根路径和子路径命令见
[Gin example](../examples/gin/README.md)。该独立示例需要 Go 1.26+，公共库仍保持
Go 1.22 基线；使用其他 Gin 版本的业务项目按自身依赖要求选择工具链。从 `gin-swagger` 切换时请阅读
[迁移说明](MIGRATING_FROM_GIN_SWAGGER.md)。

## 当前源码新增配置

本节描述当前源码中的新 API，**不属于已发布的 `v0.9.2`**。在本仓库可通过
`knife4x/examples/gin` 的本地 module 替换运行；公共 module 的正式消费仍按上面的
已发布版本说明，本文不代表已经发布新版本。旧的单 `SpecURL` 接法继续有效。

| 字段 | 默认行为与边界 |
|---|---|
| `Disabled` | 默认 `false`；为 `true` 时直接返回 `next`（nil 则 404），不读取文件或验证未使用的文档配置 |
| `SpecURL` / `Specs` | 二选一；`SpecURL` 对应 `default` 分组，`Specs` 为有序的 `[]Spec{Name, URL}`，名称去除首尾空白后须非空且唯一 |
| `BasicAuth` | nil 关闭；使用 `*BasicAuthConfig{Username, Password, Realm}`，用户名与密码须同时非空，默认 Realm 为 `Knife4x` |
| `UISettings` | nil 使用共享 UI 默认值；受支持的布尔字段为 `*bool`，可区分未设置和显式 `false` |
| `Documents` | `[]MarkdownDocument`，支持直接内容或 `fs.FS`，所有配置分组都可见 |

### Basic Auth 与完整关闭

```go
docsEnabled := os.Getenv("DOCS_ENABLED") == "true"
app := http.NewServeMux()
app.HandleFunc("/api/ping", servePing)
if docsEnabled {
    app.HandleFunc("/internal/openapi.json", serveOpenAPI)
}

handler, err := knife4x.NewHandler(knife4x.Config{
    Disabled: !docsEnabled,
    BasePath: "/internal",
    SpecURL:  "openapi.json",
    BasicAuth: &knife4x.BasicAuthConfig{
        Username: os.Getenv("DOCS_USERNAME"),
        Password: os.Getenv("DOCS_PASSWORD"),
    },
}, app)
if err != nil {
    log.Fatal(err)
}
log.Fatal(http.ListenAndServe(":8080", handler))
```

示例需在 import 中增加 `os`；启用文档时必须设置两个凭据变量。Basic Auth 在
外层 Handler 验证，保护 `/internal/doc.html`、内嵌资源（包括 Worker、动态分块与
OAuth 回调）以及配置的本地 spec 路径，覆盖所有 HTTP 方法。认证不会替代业务 API
的安全控制；请通过 HTTPS 或可信 TLS 终止代理部署。

根相对 URL 的保护路径与 `BasePath` 无关，例如 `/openapi.json` 仍保护根路径。
相对 URL 则按 `BasePath` 解析；查询参数不缩小路径保护范围。完整 HTTP(S) URL
由目标服务保护，即使恰好指向同一个源，也不属于此处自动保护的本地 URL。
Knife4x 不代理远端文档、不向它转发账号密码；宿主暴露的其他 spec 别名也应自行保护。

`Disabled` 仅取消 Knife4x 挂载和保护。上面的同一个 `docsEnabled` 同时控制宿主
spec 注册，才能把两者一起关闭；业务 `/api/ping` 继续可用。

### 多文档分组

```go
handler, err := knife4x.NewHandler(knife4x.Config{
    BasePath: "/internal",
    Specs: []knife4x.Spec{
        {Name: "用户中心", URL: "users.json"},
        {Name: "订单中心", URL: "/spec/orders.json"},
    },
}, app)
```

两个 spec 分别由宿主提供在 `/internal/users.json` 与 `/spec/orders.json`。
列表顺序即分组顺序，不能同时再设置 `SpecURL`。名称作为 UI 路由的单个路径段，不能为 `.` / `..`，也不能包含 `/`、`\`、`?`、`#`、`%` 或控制字符；中文及普通空格可用。这是静态 URL 列表，不提供注册中心、
服务发现、文档代理或 OpenAPI 生成器；各分组继续按 OpenAPI 的 `servers` 发起业务请求。

### UI 默认值与附加 Markdown

```go
//go:embed docs/*.md
var documentation embed.FS

func boolValue(value bool) *bool { return &value }

// 在创建 Handler 的配置中加入：
cfg.UISettings = &knife4x.UISettings{
    Language:           "zh-CN",
    EnableDebug:        boolValue(false),
    EnableRequestCache: boolValue(true),
    EnableVersion:      boolValue(true),
    EnableCustomHome:   boolValue(true),
    HomeMarkdown:       "# 内部接口文档\n请先阅读接入说明。",
    EnableCustomFooter: boolValue(true),
    FooterMarkdown:     "内部使用",
}
cfg.Documents = []knife4x.MarkdownDocument{
    {Title: "接入说明", FS: documentation, Path: "docs/start.md"},
    {Title: "错误码", Content: "# 错误码\n业务错误码见各接口说明。"},
}
```

示例需导入 `embed` 并提供 `docs/start.md`。同一个 Markdown 条目只能选择
`Content` 或 `FS` + `Path`，不能同时提供；标题不能为空。文件只在 `NewHandler`
创建时读取，文件不存在或配置不合法会返回错误；之后修改文件不会改变已创建 Handler。
附加文档与 spec 自带 Markdown 并列显示，不覆盖或改写原始 spec，也不写入其导出内容。

优先级为：共享 UI 默认值 < Go 的 `UISettings` < spec 中受支持的设置扩展 <
浏览器本地选择。语言接受 `zh-CN`、`en-US`、`ja-JP`；`HomeMarkdown` 和
`FooterMarkdown` 需要同时启用对应 `EnableCustomHome` / `EnableCustomFooter`。
关闭调试或隐藏菜单只是界面设置，不能作为接口访问控制。

### 外层鉴权与反向代理

Gin 示例的请求顺序是 `外层中间件 → Knife4x → Gin`。仅对内层 `router.Use(...)`
设置鉴权，无法保护已由 Knife4x 返回的文档页面和静态资源。除内置 Basic Auth 外，
可以用宿主已有的、签名为 `func(http.Handler) http.Handler` 的中间件包住最终 Handler：

```go
handler, err := knife4x.NewHandler(cfg, app)
if err != nil {
    log.Fatal(err)
}
// requireSession 由宿主实现，检查其现有会话；这里会覆盖整个服务，包括业务 API。
log.Fatal(http.ListenAndServe(":8080", requireSession(handler)))
```

若只保护文档区域，应在外层按文档和 spec 路径分派，而非依靠内层 Gin 路由分组。
代理部署应保留 `Authorization`，将 UI、OAuth 回调、Worker、动态分块及本地 spec
一起转发，并让上游收到与 `BasePath` 一致的路径。若代理剥离前缀，应同时设计并验证
浏览器资源 URL、spec URL 与上游挂载路径；`BasePath` 不自动推断 `X-Forwarded-Prefix`。
不要让登录页或 SPA fallback 替代丢失的 JS 分块，并保留正确的 JavaScript MIME。
CSP 仍须授权内联启动配置和同源模块 Worker，不能因加了 Basic Auth 就省略这些部署要求。

## UI 资产

`internal/ui/static/` 是 `front/core` 与 `front/ui-react` 的生成快照，禁止手工修改。
唯一更新方式：

```bash
./tools/sync-knife4x-ui.sh
```

检查已提交资产是否与当前前端源码和 `front/bun.lock` 一致：

```bash
./tools/sync-knife4x-ui.sh --check
```

Handler 将构建入口 `static/index.html` 暴露为 `/doc.html`。Knife4x 使用自己的
embed 配置启动，不请求 Java 的 `/knife4j/config`。

## 验证

使用 Go 1.26+ 在仓库根目录验证公共库与 Gin 示例：

```bash
./tools/test-knife4x-go.sh
```

使用 Go 1.22 验证公共库的最低版本兼容：

```bash
./tools/test-knife4x-go.sh --module core
```

脚本禁用自动工具链切换，确保实际验证所选 Go 版本；`--module gin` 可单独验证示例。

Knife4x 与 Java `5.x` 使用独立版本和发布坐标，采用
[Apache-2.0](LICENSE) 许可证。产品边界见 [Knife4x 总览](../README.md)。
