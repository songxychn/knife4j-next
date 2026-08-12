# knife4x / go

Go module：

```text
github.com/songxychn/knife4j-next/knife4x/go
```

Knife4x 只消费 OpenAPI 3 JSON 文档，不生成 spec，不支持 OAS2 / Swagger 2。核心只依赖
标准库 `net/http`；Gin 只是可运行的组合示例，不是库依赖。

当前公开版本为 `v0.2.3`，对应仓库 tag `knife4x/go/v0.2.3`：

```bash
go get github.com/songxychn/knife4j-next/knife4x/go@v0.2.3
```

`v0.2.3` 保持 `Config`、`NewHandler` 与路由语义不变，只同步内嵌 React UI 补丁
（宽屏固定页面布局与区域滚动，窄屏保留 document 滚动回退）。

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

把顶层为 `openapi: 3.x` 的 JSON 保存为当前目录的 `openapi.json`。启动后打开
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
[Gin example](../examples/gin/README.md)。从 `gin-swagger` 切换时请阅读
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

在仓库根目录运行：

```bash
./tools/test-knife4x-go.sh
```

Knife4x 与 Java `5.x` 使用独立版本和发布坐标，采用
[Apache-2.0](LICENSE) 许可证。产品边界见 [Knife4x 总览](../README.md)。
