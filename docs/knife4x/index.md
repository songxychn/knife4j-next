---
title: Knife4x Go
description: 在 Go 服务中嵌入 Knife4j React UI，加载已有 OpenAPI 3 文档并挂载调试控制台。
---

# Knife4x Go

Knife4x 在 Go 进程中嵌入 Knife4j Next 的 React 文档与调试 UI。公共库只依赖标准库
`net/http`，不绑定 Gin、Echo 或 Chi；它消费已有的 OpenAPI 文档，不生成 spec。
Go module、版本和发布流程独立于 Java `5.x`，Rust 仍后置。

当前版本：`v0.11.0`。

## 安装与最小接入

公共库需要 Go 1.22 或更高版本，直接消费 module 无需 JavaScript 运行时：

```bash
go get github.com/songxychn/knife4j-next/knife4x/go@v0.11.0
```

把下面的完整程序保存为 `main.go`，在已有 Go module 中运行 `go run .`。
宿主提供 OpenAPI JSON 和业务路由，Knife4x 在外层提供 UI：

<<< ./snippets/basic.go

打开 `http://localhost:8080/doc.html` 查看文档，`/openapi.json` 是宿主提供的 spec，
`/api/ping` 是业务接口。默认不会为 `/` 或 `index.html` 增加重定向或 SPA fallback；
Knife4x 不拥有的请求继续交给宿主 Handler。

入口接受 OpenAPI 3.0.x / 3.1.x / 3.2.x **JSON**，不接受 YAML 或 Swagger 2 / OAS2。
3.1 与 3.2 的 Schema、资源授权和浏览器调试边界分别见
[OpenAPI 3.1](../guide/openapi31.md) 与 [OpenAPI 3.2](../guide/openapi32.md)。

## 宿主配置

自 `v0.10.0` 起支持 Basic Auth、`Disabled`、`Specs`、`UISettings` 和 `Documents`。
可配置文档访问保护、静态分组、UI 默认值和附加 Markdown 文档。
旧的单 `SpecURL` / `BasePath` 接法保持兼容；完整字段与优先级统一见[配置参考](./configuration.md)。

| 要完成的事 | 文档入口 |
| --- | --- |
| 配置分组、UI 默认值或附加 Markdown | [配置参考](./configuration.md) |
| Basic Auth、完整关闭、子路径、Gin、代理与 CSP | [接入与部署](./deployment.md) |
| 从 gin-swagger 切换，检查 OAS2 与鉴权迁移 | [迁移指南](./migration.md) |
| 查看已发布版本的能力变化 | [版本记录](./releases.md) |
| 核对 Go、浏览器与 Worker 部署要求 | [兼容矩阵](../reference/compatibility.md) |

## 仓库内运行示例

```bash
cd knife4x/examples/gin
go run .
```

Gin 示例是独立 module，需要 Go 1.26+，其依赖不会进入公共库；
完整源码、命令和接入层级见[部署章节](./deployment.md#gin-与外层中间件)。

源码开发、生成物同步与验证命令保留在仓库 `knife4x/go/README.md`，
发布与公共消费验收规则保留在 `knife4x/go/RELEASE.md`。
