---
title: Go 配置参考
---

# Go 配置参考

本文以 `v0.10.1` 的公开类型为准，包含 `SpecURL`、`BasePath`、
`Specs`、`Disabled`、`BasicAuth`、`UISettings`、`Documents` 及其关联类型。
安装与最小接入见[快速开始](./index.md)。

## Config

`NewHandler(cfg Config, next http.Handler) (http.Handler, error)` 在创建时验证配置、
读取 Markdown 并生成启动页。配置或文件读取失败会返回错误；不要忽略 `err`。
`next` 为 nil 时，未被 Knife4x 处理的请求返回 404。

| 字段 | Go 类型 | 可用版本 | 说明 |
| --- | --- | --- | --- |
| `SpecURL` | `string` | `v0.10.0` | 单一 OpenAPI JSON URL，对应 `default` 分组；与非空 `Specs` 互斥 |
| `BasePath` | `string` | `v0.10.0` | UI 挂载前缀；空值为 `/`，须为干净的绝对 URL 路径，尾部 `/` 会移除 |
| `Specs` | `[]Spec` | `v0.10.0` | 有序的静态文档分组；为空时使用 `SpecURL` |
| `Disabled` | `bool` | `v0.10.0` | 默认 `false`；为 `true` 时直接返回 `next`，不验证文档配置或读取文件 |
| `BasicAuth` | `*BasicAuthConfig` | `v0.10.0` | nil 默认关闭；保护 UI 资源与配置中的本地 spec 路径 |
| `UISettings` | `*UISettings` | `v0.10.0` | 低于 spec 扩展和浏览器本地选择的 UI 默认值 |
| `Documents` | `[]MarkdownDocument` | `v0.10.0` | 在所有配置分组中显示的附加 Markdown 文档 |

表中的 `v0.10.0` 表示该版本支持这些字段，不表示所有字段均首次引入于此版本。
启用文档时必须选择非空 `SpecURL` 或非空 `Specs`。`Disabled` 不会关闭宿主自行注册的
spec 路由，也不会继续为其提供文档鉴权；完整关闭方式见[接入与部署](./deployment.md#完整关闭-ui-和-spec)。

`BasePath: "/internal"` 的入口为 `/internal/doc.html`。相对 URL `openapi.json`
解析为 `/internal/openapi.json`；根相对 URL `/openapi.json` 仍指向根路径。
完整 HTTP(S) URL 由浏览器直接加载，跨域时目标服务须允许相应 CORS。
`BasePath` 不是业务 API 的 base URL；业务请求继续按文档的 `servers` 与 path 解析。

## Spec

| 字段 | Go 类型 | 可用版本 | 说明 |
| --- | --- | --- | --- |
| `Name` | `string` | `v0.10.0` | 分组名；去除首尾空白后非空且唯一，列表顺序即分组顺序 |
| `URL` | `string` | `v0.10.0` | 文档 JSON URL，可为相对、根相对或完整 HTTP(S) URL |

分组名用于一个路由段，不能为 `.`、`..` 或 `group`，也不能含 `/`、反斜线、`?`、`#`、`%`
或控制字符。共享 UI 将 `group/home` 用作尚未选定分组时的入口。支持中文等非 ASCII 名称。
从 `v0.10.1` 起，`SpecURL` 与 `Specs[].URL` 统一拒绝反斜线和 URL 内的 userinfo 凭据。两种配置都要求绝对 URL 使用 HTTP(S)，并拒绝省略协议的 `//host/path`。

多分组是固定 URL 列表，不包含注册中心、动态服务发现、文档代理或规范转换。
各分组独立加载，一组失败不应阻止选择其他组。

<<< ./snippets/multispec.go

示例的两份 spec 分别由宿主提供在 `/internal/users.json` 和 `/spec/orders.json`；
文档入口为 `/internal/doc.html`。

## BasicAuthConfig

| 字段 | Go 类型 | 可用版本 | 说明 |
| --- | --- | --- | --- |
| `Username` | `string` | `v0.10.0` | 非空且不能含 `:`；不自动去除首尾空白 |
| `Password` | `string` | `v0.10.0` | 非空；不自动去除首尾空白，不写入浏览器启动配置 |
| `Realm` | `string` | `v0.10.0` | 空值为 `Knife4x`；仅接受可打印 ASCII，HTTP challenge 中会安全转义 |

nil 表示关闭；非 nil 配置不能只填一个凭据。文档访问保护与 UI 中为业务请求配置
Basic / Bearer / OAuth2 是两个独立能力。保护对象、本地/远端 URL 和 HTTPS 部署要求见
[访问保护](./deployment.md#basic-auth-与保护范围)。

## UISettings

所有 `*bool` 的 nil 均表示未设置，指向 `false` 表示显式关闭。下表默认值指共享 UI
在没有 Go 配置、spec 扩展和浏览器本地覆盖时的值，并非 Go 指针的零值。

| 字段 | Go 类型 | 可用版本 | 说明 |
| --- | --- | --- | --- |
| `Language` | `string` | `v0.10.0` | 语言偏好。自 `v0.10.1` 起由共享 UI 解析，支持 `zh-CN`、`en-US`、`ja-JP` 及同语种变体；空值或不支持的值沿用语言检测 |
| `EnableDebug` | `*bool` | `v0.10.0` | 显示调试页，UI 默认 `true` |
| `EnableSearch` | `*bool` | `v0.10.0` | 显示目录搜索，UI 默认 `true` |
| `EnableOpenAPI` | `*bool` | `v0.10.0` | 显示原始 OpenAPI 标签页，UI 默认 `true` |
| `EnableRequestCache` | `*bool` | `v0.10.0` | 恢复接口请求参数缓存，UI 默认 `true` |
| `EnableVersion` | `*bool` | `v0.10.0` | 本地接口新增/变化提示，UI 默认 `false` |
| `EnableModels` | `*bool` | `v0.10.0` | 显示模型入口，UI 默认 `true` |
| `EnableDocumentManage` | `*bool` | `v0.10.0` | 显示文档管理入口，UI 默认 `true` |
| `EnableGroup` | `*bool` | `v0.10.0` | 显示分组选择器，UI 默认 `true` |
| `EnableFooter` | `*bool` | `v0.10.0` | 显示默认 Footer，UI 默认 `true` |
| `EnableCustomFooter` | `*bool` | `v0.10.0` | 显示非空自定义 Footer，UI 默认 `false` |
| `EnableCustomHome` | `*bool` | `v0.10.0` | 使用非空自定义首页，UI 默认 `false` |
| `HomeMarkdown` | `string` | `v0.10.0` | 首页 Markdown 内容，需同时启用 `EnableCustomHome` |
| `FooterMarkdown` | `string` | `v0.10.0` | Footer Markdown 内容，需同时启用 `EnableCustomFooter` |

生效顺序为 **共享 UI 默认值 < Go 的 UISettings < spec 中受支持的设置扩展 < 浏览器本地选择**。
这些默认值不改写原始 spec 或其导出内容。UI 隐藏调试、搜索或菜单不是接口访问控制。

## MarkdownDocument

| 字段 | Go 类型 | 可用版本 | 说明 |
| --- | --- | --- | --- |
| `Title` | `string` | `v0.10.0` | 去除首尾空白后非空的文档标题 |
| `Content` | `string` | `v0.10.0` | 直接 Markdown 内容；允许空文档，不能把非空内容与 FS 来源同时提供 |
| `FS` | `fs.FS` | `v0.10.0` | 与 `Path` 一起提供，例如 `embed.FS` 或 `os.DirFS` |
| `Path` | `string` | `v0.10.0` | FS 内有效的相对文件路径，不能是绝对路径或含 `..` 路径段 |

每项选择直接 `Content` 或 `FS` + `Path`；不能只填 FS 或只填 Path。
文件仅在创建 Handler 时读取，读取失败会返回错误；修改源文件不会改变已创建的 Handler。
附加文档在所有配置分组中显示，与 spec 自带 Markdown 并列，不覆盖 spec 内容，
也不写入原始 OpenAPI 导出。内容复用既有 Markdown 渲染与安全处理，不新增独立渲染器。

以下完整程序展示 UI 默认值与两种文档来源；把同目录的
`guide.txt` 一起放在源码旁边以满足 `go:embed`：

<<< ./snippets/settings.go

示例程序旁的 `guide.txt` 可使用以下 Markdown 内容：

<<< ./snippets/guide.txt
