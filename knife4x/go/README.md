# knife4x / go

在 Go 服务中嵌入 Knife4j Next 的 React 文档与调试 UI。公共 module
`github.com/songxychn/knife4j-next/knife4x/go` 只依赖标准库 `net/http`，不绑定 Web 框架，
消费已有 OpenAPI 3.0 / 3.1 / 3.2 JSON，不生成 spec，也不支持 OAS2 或 YAML 入口。

完整用户手册统一维护在[文档站](https://knife4jnext.com/knife4x/)；仓库内入口为
[Go 快速开始](../../docs/knife4x/index.md)。

## 安装与最小示例

当前版本：`v0.11.0`，
对应 tag `knife4x/go/v0.11.0`。需要 Go 1.22+，直接消费 module 无需 JavaScript 运行时。

```bash
go get github.com/songxychn/knife4j-next/knife4x/go@v0.11.0
```

下面程序在宿主中提供 JSON 和业务路由，启动后访问 `http://localhost:8080/doc.html`：

```go
package main

import (
	"log"
	"net/http"

	knife4x "github.com/songxychn/knife4j-next/knife4x/go"
)

func main() {
	app := http.NewServeMux()
	app.HandleFunc("/openapi.json", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"openapi":"3.0.3","info":{"title":"Example API","version":"1"},"paths":{"/api/ping":{"get":{"responses":{"200":{"description":"pong"}}}}}}`))
	})
	app.HandleFunc("/api/ping", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"message":"pong"}`))
	})

	handler, err := knife4x.NewHandler(knife4x.Config{
		SpecURL: "/openapi.json",
	}, app)
	if err != nil {
		log.Fatal(err)
	}
	log.Fatal(http.ListenAndServe(":8080", handler))
}
```

`v0.10.0` 新增 `BasicAuth`、`Disabled`、`Specs`、`UISettings` 和 `Documents`；
类型、语义和可用版本见[配置参考](../../docs/knife4x/configuration.md)。

- [接入与部署](../../docs/knife4x/deployment.md)：访问保护、完整关闭、Gin、子路径、反向代理与 Worker/CSP。
- [迁移指南](../../docs/knife4x/migration.md)：从 gin-swagger 切换与原有鉴权迁移。
- [版本记录](../../docs/knife4x/releases.md)：历史版本能力与边界。
- [兼容矩阵](../../docs/reference/compatibility.md)：Go、浏览器与 Worker 部署要求。

## 源码开发与发布

源码 UI 构建与同步使用稳定 Bun `1.4.x`（最低 `1.4.4`，见根目录 `.bun-version`）。
在仓库根目录运行：

```bash
./tools/test-knife4x-go.sh
./tools/test-docs.sh
./tools/sync-knife4x-ui.sh --check
```

Go 1.22 最低版本验证使用 `./tools/test-knife4x-go.sh --module core`；完整 Gin 示例需 Go 1.26+。
`internal/ui/static/` 是共享前端生成物，仅通过 `./tools/sync-knife4x-ui.sh` 更新，禁止手改。
验证脚本范围见[工具说明](../../tools/README.md)，发布与公共消费验收见 [RELEASE.md](RELEASE.md)。
采用 [Apache-2.0](LICENSE) 许可证，与 Java 版本和发布流程独立。
