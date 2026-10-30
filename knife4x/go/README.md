# knife4x / go

Go module：

```text
github.com/songxychn/knife4j-next/knife4x/go
```

Knife4x 已发布版本消费 OpenAPI 3.0.x / 3.1.x / 3.2.x JSON 文档，不生成 spec，不支持 OAS2 / Swagger 2。核心只依赖
标准库 `net/http`；Gin 只是可运行的组合示例，不是库依赖。合法 3.2 JSON 可经 `SpecURL`
交给同一套 React UI；限制见
[OpenAPI 3.2 支持矩阵](../../docs/guide/openapi32.md)。

当前发布版本为 `v0.9.0`，对应仓库 tag `knife4x/go/v0.9.0`：

```bash
go get github.com/songxychn/knife4j-next/knife4x/go@v0.9.0
```

相较于 `v0.8.9`，单接口 Markdown 复制与完整文档导出共用字段、请求/响应和示例规则；不完整内容需确认并保留诊断。同步对象候选截断、千字段示例生成及 allOf 无类型字符串约束修复，保留作者示例、方向、授权资源图、取消与安全预算（PR #965/#967/#970/#975）。

Schema 会话改用同源 ES module Worker；部署须保留 Worker 和动态分块、允许相应 CSP 并提供正确 JavaScript MIME，失败有诊断。Go 内联配置仍按原有 CSP 方式授权。源码构建统一要求稳定 Node `26.x`，直接使用 module 不需要 Node。

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
`v0.9.0` 可加载合法 3.2 JSON。启动后打开
<http://localhost:8080/doc.html>。

`Config` 只有两个字段：

| 字段 | 说明 |
|---|---|
| `SpecURL` | 必填；OpenAPI 3 文档 URL，可为根相对、相对或完整 HTTP(S) URL |
| `BasePath` | 可选；文档挂载前缀，空值等同于 `/` |

`BasePath: "/internal"` 时，文档入口为 `/internal/doc.html`，静态资源也位于
`/internal/` 下。它不是入口文件名，也不是业务 API base URL。相对
`SpecURL: "openapi.json"` 会解析到 `/internal/openapi.json`；根相对
`SpecURL: "/openapi.json"` 仍指向根路径。

未知路由会交给 `next`。生产环境需要关闭文档时，不创建或不挂载 Knife4x Handler
即可。

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
