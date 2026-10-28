---
title: Knife4x Go
description: 在 Go 服务中嵌入 Knife4j React UI，加载已有 OpenAPI 3 文档并挂载调试控制台。
---

# Knife4x Go

Knife4x 是面向 Go / Rust 宿主的进程内嵌入式 OpenAPI 3 UI 与调试控制台。
当前源码面向 Go `v0.9.0`（待发布；最新已发布为 `v0.8.9`），Rust 后置。它复用 Knife4j Next 的 React UI，但 module、
版本和发布流程独立于 Java `5.x`。

::: info OpenAPI 3.1 / 3.2 与发布版本
Go `v0.6.0` 将共享 React UI 的 OpenAPI 3.1.x 加载、Schema、调试诊断、导出与变化提示纳入发布，
完整边界见 [OpenAPI 3.1 支持与迁移](/guide/openapi31)。Go `v0.8.0` 将同一套 UI 的 OpenAPI 3.2.x
消费纳入发布，见 [OpenAPI 3.2 支持矩阵](/guide/openapi32)。已发布入口接受 OpenAPI 3.0.x / 3.1.x / 3.2.x
JSON，不支持 YAML 入口。下方 `v0.5.0` 及更早小节保留各自历史范围，不包含这些后续改动。
:::

## 安装

从当前仓库源码重建或同步 UI 时，Node 要求与 OAS3、Vue3 和文档站统一为稳定的 `26.x`，不接受其他主版本或预发行版。直接使用 Go module 不需要 Node，Go 与浏览器运行时要求不变。

Go module 需要 Go 1.22 或更高版本。以下示例面向待发布 `v0.9.0`；正式发布前请使用 `v0.8.9`：

```bash
go get github.com/songxychn/knife4j-next/knife4x/go@v0.9.0
```

仓库中的 [Gin 可运行示例](https://github.com/songxychn/knife4j-next/tree/master/knife4x/examples/gin)
是独立 module，需要 Go 1.26+；其 Gin 依赖与版本要求不会传递给公共库消费者。

## v0.9.0（待发布）

相较于 `v0.8.9`，单接口 Markdown 复制与完整文档导出共用字段、请求/响应和示例规则；不完整内容需确认并保留诊断。同步对象候选截断、千字段示例生成及 allOf 无类型字符串约束修复，保留作者示例、方向、授权资源图、取消与安全预算（PR #965/#967/#970/#975）。

Schema 会话改用同源 ES module Worker；部署须保留 Worker 和动态分块、允许相应 CSP 并提供正确 JavaScript MIME，失败有诊断。Go 内联配置仍按原有 CSP 方式授权。源码构建统一要求稳定 Node `26.x`，直接使用 module 不需要 Node。

公共库仍只依赖标准库；Go 1.22、module、`Config`、`NewHandler` 与路由语义不变，独立 Gin 示例仍需 Go 1.26+。浏览器沿用 `v0.8.9`，OpenAPI 3.0/3.1/3.2 JSON 消费与资源授权边界不变，仍不接受 YAML。

## v0.8.9

相较于 `v0.8.8`，同步共享 React UI 的 Schema 示例生成修复：复用同一对象展开中的属性候选，跳过重复的完整/最小属性集合搜索，避免普通宽对象过早耗尽预算。回归覆盖 OAS 3.1/3.2 的 100 字段对象请求与响应示例；保留预算上限、取消、作者示例与校验边界（PR #950）。

公共库仍只依赖标准库，Go 1.22、module、`Config`、`NewHandler` 与路由语义保持不变；独立 Gin 示例仍需 Go 1.26+。浏览器要求沿用 `v0.8.8`（Chrome/Edge 112、Firefox 116、Safari/iOS Safari 17）；OpenAPI 3.0/3.1/3.2 JSON 消费范围不变，仍不接受 YAML。

## v0.8.8

相较于 `v0.8.7`，同步共享 React UI 的 JSONPath 特殊键名/空切片取值修复、Markdown 引用块边界修复、UTF-8 Schema 相对引用修复与深层 Schema 方向分析修复，并更新国际化、拖动及清洗依赖。内嵌资产与 React 构建保持一致。

**浏览器下限提高至 Chrome/Edge 112、Firefox 116、Safari/iOS Safari 17**，因为 JSONPath 11 需要原生 RegExp `v`；不提供旧浏览器补齐，也不声称所有最低版本均已实测。详见[兼容矩阵](/reference/compatibility#浏览器基线)。

公共库仍只依赖标准库，Go 1.22 基线、module、`Config`、`NewHandler` 与路由语义保持不变；独立 Gin 示例仍需 Go 1.26+。OpenAPI 3.0/3.1/3.2 JSON 消费范围不变，仍不接受 YAML。

## v0.8.7

Go 1.22 基线、module 路径、`Config`、`NewHandler` 与路由语义保持不变。
相较于 `v0.8.6`，共享 React UI 在 Schema 字段说明列展示枚举和默认值，避免长枚举展开后重复显示摘要（PR #876）；OAS3 编译工具通过双别名迁移至 TypeScript 7，保持 UI 编译目标与公开 API（PR #878）。重新构建并同步内嵌 UI 资产。
公共库仍只依赖标准库；仓库内独立 Gin 示例更新依赖并要求 Go 1.26+，不会向库消费者传递示例依赖（PR #875）。

## v0.8.6

Go 1.22 基线、module 路径、`Config`、`NewHandler` 与路由语义保持不变。
相较于 `v0.8.5`，共享 React UI 更新同主版本依赖与 docx，并迁移 React Router 7、Vite 8、React 19 和 Ant Design 6；适配页签滚动及外部资源面板组件（PR #843、#847、#849、#851、#853、#861、#864、#865）。OAS3 开发工具迁移至 ESLint 10，UI 同步要求 Node 22.13+ 或 24+。OAS3 三个工作区统一使用 TypeScript 6.0.3，core 输出目标由 ES5 调整为 ES2015，不再提供 ES5 降级输出；包入口、公开 API 与 Vite UI 编译目标保持（PR #867）。本版本不升级 Go 依赖。

## v0.8.5

Go 1.22 基线、module 路径、`Config`、`NewHandler` 与路由语义保持不变。
相较于 `v0.8.4`，共享 React UI 修复调试正文格式化与快照写入，并收敛表单状态和测试边界（PR #837）。

## v0.8.4

Go 1.22 基线、module 路径、`Config`、`NewHandler` 与路由语义保持不变。
相较于 `v0.8.3`，共享 React UI 统一 JSON 示例与预览层级折叠，并修正请求预览词法保真与空容器折叠（PR #833）。

## v0.8.3

Go 1.22 基线、module 路径、`Config`、`NewHandler` 与路由语义保持不变。
相较于 `v0.8.2`，共享 React UI 修复 OAS 3.2 标签 Tooltip 重复名称（PR #826）、改进 OAS 3.2 文档 Schema 元校验错误定位（PR #828）、普通 JSON 示例默认展示逻辑数据并保留发送原文入口（PR #827），以及调试 JSON 响应折叠、字段说明列与等价 cURL 排版（PR #830）。

## v0.8.2

Go 1.22 基线、module 路径、`Config`、`NewHandler` 与路由语义保持不变。
相较于 `v0.8.1`，共享 React UI 修复 OAS 3.2 标签菜单重复名称（PR #817）、首页服务地址明细默认折叠（PR #818），以及窄窗口首页统计卡片与外壳横向溢出（PR #820）。

## v0.8.1

Go 1.22 基线、module 路径、`Config`、`NewHandler` 与路由语义保持不变。
相较于 `v0.8.0`，共享 React UI 修复 OAS 3.1 SchemaEngine 元校验失败后再次评估可能错误放行
（PR #810）。

## v0.8.0

Go 1.22 基线、module 路径、`Config`、`NewHandler` 与路由语义保持不变。
相较于 `v0.7.1`，共享 React UI 发布 OpenAPI 3.2.x 消费：独立解析、资源图、Schema 会话、
QUERY / 自定义方法、离线导出、变化协议 `oas3.2-v1`，以及调试页 Server 解析详情默认收起
（总路线 #767，验收 PR #807）。入口仍不接受 YAML。

## v0.7.1

Go 1.22 基线、module 路径、`Config`、`NewHandler` 与路由语义保持不变。
相较于 `v0.7.0`，共享 React UI 修复 OAS 3.1 非 ASCII 分组名下入口文档自引用 `$ref`
与 retrieval URI 身份错配，避免整篇接口降级（PR #798）。

## v0.7.0

Go 1.22 基线、module 路径、`Config`、`NewHandler` 与路由语义保持不变。
相较于 `v0.6.0`，共享 React UI 新增：

- OAS 3.1 浏览器登录会话调试：可复用浏览器会话，旧缓存保持手填模式；默认同源，跨 origin 需显式 `include`、服务端凭据 CORS 与浏览器策略允许。Cookie 值不写入预览或历史，cURL 需另行配置会话，手填 Cookie 真实发送仍阻断（PR #763）。
- 枚举下拉框输入过滤（PR #757）与接口目录当前分组标题吸顶（PR #762）。
- Schema 根节点与真实 `items` 字段的标签区分（PR #761）。

完整会话语义与限制见 [OpenAPI 3.1 支持与迁移](/guide/openapi31)。

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

- 已发布的 `v0.8.6` 消费已有的 OpenAPI 3.0.x / 3.1.x / 3.2.x JSON，不生成 spec，不支持 OAS2 / Swagger 2。
- 同一 Handler 可经 `SpecURL` 承载合法 3.2 JSON；限制见 [OpenAPI 3.2 支持矩阵](/guide/openapi32)。入口仍不接受 YAML。
- 只提供 `{BasePath}/doc.html` 入口，不为 `/` 或 `index.html` 增加重定向或 SPA fallback。
- Go 核心只依赖标准库 `net/http`；Gin 是可运行示例，不是库依赖。
- Go Handler 将配置注入 UI，Knife4x 不请求 Java 的 `/knife4j/config`。
- Go 使用独立 `0.x` 版本；Java `5.x` 发布说明和 Maven 坐标不适用于 Knife4x。

## 更多资料

- [完整 Go 接入说明](https://github.com/songxychn/knife4j-next/blob/master/knife4x/go/README.md)
- [Gin 可运行示例](https://github.com/songxychn/knife4j-next/tree/master/knife4x/examples/gin)
- [从 gin-swagger 迁移](https://github.com/songxychn/knife4j-next/blob/master/knife4x/go/MIGRATING_FROM_GIN_SWAGGER.md)
- [Go 发布与验收规则](https://github.com/songxychn/knife4j-next/blob/master/knife4x/go/RELEASE.md)
