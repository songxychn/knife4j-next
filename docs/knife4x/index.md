---
title: Knife4x Go
description: 在 Go 服务中嵌入 Knife4j React UI，加载已有 OpenAPI 3 文档并挂载调试控制台。
---

# Knife4x Go

Knife4x 是面向 Go / Rust 宿主的进程内嵌入式 OpenAPI 3 UI 与调试控制台。
当前已发布 Go `v0.2.3`，Rust 后置。它复用 Knife4j Next 的 React UI，但 module、
版本和发布流程独立于 Java `5.x`。

## 安装

Go module 需要 Go 1.22 或更高版本：

```bash
go get github.com/songxychn/knife4j-next/knife4x/go@v0.2.3
```

## v0.2.3

Go `Handler` API 与路由语义保持不变，内嵌 React UI 同步补丁：宽屏固定 Header / 接口标签 /
Footer 与区域独立滚动，窄屏保留 document 滚动回退，并限制超长自定义 Footer 高度。

## 最小接入

先由业务 Handler 提供 OpenAPI 3 JSON 和 API，再把它传给 Knife4x：

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
		_, _ = w.Write([]byte(`{
			"openapi":"3.0.3",
			"info":{"title":"Example API","version":"1.0.0"},
			"paths":{}
		}`))
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

启动后访问 `http://localhost:8080/doc.html`。

## 配置

| 字段 | 要求 | 说明 |
| --- | --- | --- |
| `SpecURL` | 必填 | 已有 OpenAPI 3 文档 URL，可使用根相对、相对或完整 HTTP(S) URL |
| `BasePath` | 可选 | UI 挂载前缀；必须是以 `/` 开头的 clean absolute path，空值等同于 `/` |

例如 `BasePath: "/internal"` 时，入口为 `/internal/doc.html`。生产环境不需要文档时，
不要创建或挂载 Knife4x Handler；Knife4x 不额外提供 `enabled` 开关。

相对 `SpecURL: "openapi.json"` 会在该前缀下解析为 `/internal/openapi.json`；
根相对 `SpecURL: "/openapi.json"` 仍指向根路径。Knife4x 不拥有的请求会交回传入的
业务 Handler。使用跨域的完整 URL 时，目标服务必须允许浏览器 CORS。

## 使用边界

- 只消费已有的 OpenAPI 3 JSON，不生成 spec，不支持 OAS2 / Swagger 2。
- 只提供 `{BasePath}/doc.html` 入口，不为 `/` 或 `index.html` 增加重定向或 SPA fallback。
- Go 核心只依赖标准库 `net/http`；Gin 是可运行示例，不是库依赖。
- Go Handler 将配置注入 UI，Knife4x 不请求 Java 的 `/knife4j/config`。
- Go 使用独立 `0.x` 版本；Java `5.x` 发布说明和 Maven 坐标不适用于 Knife4x。

## 更多资料

- [完整 Go 接入说明](https://github.com/songxychn/knife4j-next/blob/master/knife4x/go/README.md)
- [Gin 可运行示例](https://github.com/songxychn/knife4j-next/tree/master/knife4x/examples/gin)
- [从 gin-swagger 迁移](https://github.com/songxychn/knife4j-next/blob/master/knife4x/go/MIGRATING_FROM_GIN_SWAGGER.md)
- [Go 发布与验收规则](https://github.com/songxychn/knife4j-next/blob/master/knife4x/go/RELEASE.md)
