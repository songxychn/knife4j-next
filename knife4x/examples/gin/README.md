# Knife4x Gin example

本示例让 Gin 作为业务 `http.Handler`，再由 Knife4x 的框架无关 Handler 同时提供文档资源。
它只消费现成的 OpenAPI 3 文档，不使用 `swag` 或 `gin-swagger` 生成 spec。
示例内嵌的固定文档与 React 验收共用同一份 Springdoc 2.9.1 OpenAPI 3.1
快照，覆盖 nullable、const、tuple、GET/JSON/binary/multipart requestBody
以及请求/响应 Schema 引用。

本示例需要 Go 1.26 或更高版本。示例是独立 module，Gin 及其依赖不会进入公共库
`knife4x/go`；公共库仍兼容 Go 1.22。

本目录通过本地 `replace ../../go` 使用当前源码，包含尚未进入已发布 `v0.9.2`
的访问保护、多分组、UI 默认值和附加 Markdown API。旧版本消费者不能直接复制这些新增字段。

在本目录运行：

```bash
go run .
```

打开：

- Knife4x：<http://localhost:8080/doc.html>
- OpenAPI 3 fixture：<http://localhost:8080/openapi.json>
- OAS 3.1 matrix API：<http://localhost:8080/oas31/json>
- 业务接口：<http://localhost:8080/api/ping>

子路径部署：

```bash
go run . -base-path /internal
```

此时文档入口为 <http://localhost:8080/internal/doc.html>，fixture 为
<http://localhost:8080/internal/openapi.json>；业务接口仍是
<http://localhost:8080/api/ping>，不会拼接文档挂载前缀。

## 多分组与附加文档

```bash
go run . -base-path /internal -multi-spec
```

此时有两个分组：`Matrix` 加载 `/internal/openapi.json`，`Ping` 加载
`/internal/ping-openapi.json`。这是两个固定 URL，不进行服务发现或文档代理。
两组都显示通过 `go:embed` 加载的“接入说明”。示例 UI 默认使用中文并开启接口变化提示；
spec 设置和用户已有的本地选择仍可覆盖这些默认值。

## Basic Auth

```bash
read -s 'KNIFE4X_BASIC_PASSWORD?文档密码: '
echo
export KNIFE4X_BASIC_PASSWORD
export KNIFE4X_BASIC_USER=docs
go run . -base-path /internal -multi-spec
```

以上输入命令适用于 macOS 默认 zsh；也可由部署系统注入两个环境变量。任意一个变量
单独设置都会使示例启动失败，两个都不设置则不启用认证。密码不写入源码或启动日志。
访问文档、静态资源与两个本地 spec URL 都须认证；业务 `/api/ping` 保持可用，
其真实安全策略由业务实现。浏览器可按 HTTP Basic 认证提示输入账号密码；部署请使用 HTTPS。

内置 Basic Auth 位于外层 Knife4x Handler。仅在内层 Gin 添加 `router.Use(...)`
不能保护文档 UI。需要复用自有会话中间件时，包住传给 `ListenAndServe` 的最终 Handler；
标准库组合与反向代理要求见 [Go 接入说明](../../go/README.md#外层鉴权与反向代理)。

## 同时关闭 UI 和 spec

```bash
go run . -base-path /internal -multi-spec -docs-enabled=false
```

`/internal/doc.html`、内嵌资源、`/internal/openapi.json` 与
`/internal/ping-openapi.json` 都不再挂载，返回 404；`/api/ping` 和矩阵业务接口继续运行。
示例用同一开关设置 `Config.Disabled` 并停止注册 Gin spec 路由。单独设置
`Config.Disabled` 不会关闭其他代码已注册的 spec，也不会继续提供文档鉴权。

本地 module 的 `replace ../../go` 仅用于 monorepo 开发，不是发布后的用户接入方式。
