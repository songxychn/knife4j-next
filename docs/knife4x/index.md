---
title: Knife4x Go
description: 在 Go 服务中嵌入 Knife4j React UI，加载已有 OpenAPI 3 文档并挂载调试控制台。
---

# Knife4x Go

Knife4x 是面向 Go / Rust 宿主的进程内嵌入式 OpenAPI 3 UI 与调试控制台。
当前已发布 Go `v0.5.0`，Rust 后置。它复用 Knife4j Next 的 React UI，但 module、
版本和发布流程独立于 Java `5.x`。

::: info OpenAPI 3.1 与发布版本
当前 `master` 的共享 React UI 已对 OpenAPI 3.1.x 提供加载、Schema、调试诊断、导出与变化提示契约，
详见 [OpenAPI 3.1 支持与迁移](/guide/openapi31)。下方 `v0.5.0` 小节是已发布版本的历史记录；
不要据此推断 `v0.5.0` 已包含后续 OAS 3.1 提交，实际制品能力以 Go 发布说明为准。
:::

## 安装

Go module 需要 Go 1.22 或更高版本：

```bash
go get github.com/songxychn/knife4j-next/knife4x/go@v0.5.0
```

## v0.5.0

Go `Handler` API 与路由语义保持不变，内嵌 React UI 新增页签左右关闭、响应状态概要、
Knife4j 本地数据安全清理、单接口 OpenAPI 3.0.x 下载，以及按分组隔离的接口新增/变化提示。

## v0.4.2

Go `Handler` API 与路由语义保持不变，内嵌 React UI 修复动态参数开关未接入表单请求体
的问题；开启后，urlencoded 与 multipart Body 可以添加 OpenAPI 未声明的文本字段，
并在预览、真实请求、缓存、历史与重置间保持一致。

## v0.4.1

Go `Handler` API 与路由语义保持不变，内嵌 React UI 恢复 HTML、DOC、DOCX 与整篇
Markdown 离线导出中的请求示例和响应示例，并覆盖显式 example、named example、本地
引用与 schema 生成回退。

## v0.4.0

Go `Handler` API 与路由语义保持不变，内嵌 React UI 支持对当前可见的 Path、Query、
Header 与 Cookie 参数批量选择；HTML、DOC、DOCX 与整篇 Markdown 共用一致的离线
导出内容模型，Word 导出提供 `tag -> API` 两级大纲与原生编号。

## v0.3.0

Go `Handler` API 与路由语义保持不变，内嵌 React UI 同步新能力：请求参数支持“全部分组”
和“当前分组”两级作用域；请求参数、Cookie 会话与 OpenAPI 鉴权拆分为独立页面，
Cookie 与鉴权仍严格按分组隔离。

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
