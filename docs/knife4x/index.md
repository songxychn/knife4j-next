---
title: Knife4x Go
description: 在 Go 服务中嵌入 Knife4j React UI，加载已有 OpenAPI 3 文档并挂载调试控制台。
---

# Knife4x Go

Knife4x 是面向 Go / Rust 宿主的进程内嵌入式 OpenAPI 3 UI 与调试控制台。
当前已发布 Go `v0.6.0`，Rust 后置。它复用 Knife4j Next 的 React UI，但 module、
版本和发布流程独立于 Java `5.x`。

::: info OpenAPI 3.1 与发布版本
Go `v0.6.0` 将共享 React UI 的 OpenAPI 3.1.x 加载、Schema、调试诊断、导出与变化提示纳入发布，
完整边界见 [OpenAPI 3.1 支持与迁移](/guide/openapi31)。入口仍只接受 OpenAPI 3.0.x / 3.1.x JSON，
不支持 YAML 入口或 OAS 3.2；下方 `v0.5.0` 及更早小节保留各自历史范围，不包含这些后续 OAS 3.1 改动。
:::

## 安装

Go module 需要 Go 1.22 或更高版本：

```bash
go get github.com/songxychn/knife4j-next/knife4x/go@v0.6.0
```

## v0.6.0

Go 1.22 基线、module 路径、`Config`、`NewHandler` 与路由语义保持不变。
内嵌 React UI 新增以下能力，已有 OAS 3.0.x 路径继续保留：

- OAS 3.1 与 JSON Schema 2020-12 字段树和模型，保留作者示例，并在预算内生成经校验的候选示例。
- 参数与 JSON、urlencoded、multipart 请求体的 Schema 校验和编码，以及非阻断的 JSON 响应诊断。
- 对已发现的精确 URI 授权后加载跨文档资源，以同一不可变资源图支持解析、诊断、导出和变化提示。
- 在完整资源图下导出可移植的单接口 OpenAPI JSON；HTML、Markdown、DOC、DOCX 使用同一离线快照；`paths` 操作的变化指纹与 OAS 3.0 基线隔离。
- 修复长 FQN 类型挤压字段列及悬浮预览溢出，并补齐资源消费、编码锚点导出和示例缺失诊断。

外部资源默认拒绝，SchemaEngine 只使用已登记的资源，不自行联网；不执行未知方言或自定义词汇。
显式 Cookie 参数仅支持预览和 cURL，浏览器真实发送前阻断；不提供 Cookie jar 写入、主动 Webhook 调用
或 `mutualTLS` 客户端证书注入。完整能力与浏览器限制见 [OpenAPI 3.1 支持与迁移](/guide/openapi31)。

已合并改动包括示例 [#715](https://github.com/songxychn/knife4j-next/pull/715)、
资源图 [#727](https://github.com/songxychn/knife4j-next/pull/727)、
表单 [#728](https://github.com/songxychn/knife4j-next/pull/728) / [#730](https://github.com/songxychn/knife4j-next/pull/730)、
单接口导出 [#732](https://github.com/songxychn/knife4j-next/pull/732) / [#733](https://github.com/songxychn/knife4j-next/pull/733)、
离线导出 [#734](https://github.com/songxychn/knife4j-next/pull/734)、
变化提示 [#736](https://github.com/songxychn/knife4j-next/pull/736)、
FQN 展示 [#731](https://github.com/songxychn/knife4j-next/pull/731)，以及
Schema 预扫描 [#743](https://github.com/songxychn/knife4j-next/pull/743) 和
后续语义修复 [#750](https://github.com/songxychn/knife4j-next/pull/750)。

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

- 只消费已有的 OpenAPI 3.0.x / 3.1.x JSON，不生成 spec，不支持 OAS2 / Swagger 2 或 OAS 3.2。
- 只提供 `{BasePath}/doc.html` 入口，不为 `/` 或 `index.html` 增加重定向或 SPA fallback。
- Go 核心只依赖标准库 `net/http`；Gin 是可运行示例，不是库依赖。
- Go Handler 将配置注入 UI，Knife4x 不请求 Java 的 `/knife4j/config`。
- Go 使用独立 `0.x` 版本；Java `5.x` 发布说明和 Maven 坐标不适用于 Knife4x。

## 更多资料

- [完整 Go 接入说明](https://github.com/songxychn/knife4j-next/blob/master/knife4x/go/README.md)
- [Gin 可运行示例](https://github.com/songxychn/knife4j-next/tree/master/knife4x/examples/gin)
- [从 gin-swagger 迁移](https://github.com/songxychn/knife4j-next/blob/master/knife4x/go/MIGRATING_FROM_GIN_SWAGGER.md)
- [Go 发布与验收规则](https://github.com/songxychn/knife4j-next/blob/master/knife4x/go/RELEASE.md)
