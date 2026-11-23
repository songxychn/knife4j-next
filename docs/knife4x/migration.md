---
title: 从 gin-swagger 迁移
---

# 从 gin-swagger 迁移

Knife4x 替换嵌入式文档与调试 UI，不替代 OpenAPI 生成器。先确认文档格式和鉴权的
挂载层级，再替换 UI。当前版本的安装与最小程序见[快速开始](./index.md)。

## 先检查生成的文档

现有 JSON 顶层必须声明 `openapi: 3.0.x`、`openapi: 3.1.x` 或合法 `openapi: 3.2.x`。
如果是 `swagger: "2.0"`，它属于 OAS2，不能直接迁移；先选用能生成 OpenAPI 3 的
工具，或在生成流水线显式转换并验证输出。不能只替换版本字符串。
入口不接受 YAML；3.1 与 3.2 的 Schema、外部资源及浏览器调试边界见
[OpenAPI 3.1](../guide/openapi31.md)和[OpenAPI 3.2](../guide/openapi32.md)。

从已有 Knife4x `v0.5.0` 单 spec 接法升级到 `v0.10.2`，不需要修改 `Config`、
`NewHandler` 或挂载路径。OAS 3.1 消费从 `v0.6.0` 起提供，OAS 3.2 从 `v0.8.0` 起提供；
历史变化见[版本记录](./releases.md)。

## 替换 UI 挂载

原先通常由 Gin 在 `/swagger/*any` 路由调用
`ginSwagger.WrapHandler(swaggerFiles.Handler)`。迁移后：

1. 继续保留 OpenAPI 生成步骤，并让 Gin 提供实际的 JSON URL，例如 `/openapi.json`。
2. 使用公共库 import `github.com/songxychn/knife4j-next/knife4x/go`。
3. 将 Gin engine 作为 `next` 传给 `NewHandler`，配置 `SpecURL` 指向该 JSON。
4. 将返回的外层 Handler 交给 HTTP server，入口变为 `/doc.html`。

完整可运行的 Gin 组合见[接入与部署](./deployment.md#gin-与外层中间件)。
仅在确认不再使用某个库的生成或挂载能力后，才从 `go.mod` 和 imports 中移除
`gin-swagger`、`swaggerFiles` 等依赖；不要顺带删除仍在使用的生成器。

## 子路径与鉴权迁移

`BasePath: "/internal"` 配合相对 `SpecURL: "openapi.json"` 时，宿主应提供
`/internal/openapi.json`，入口为 `/internal/doc.html`。
业务 API 仍按文档的 `servers` 和 path 解析，不会自动拼接 UI 前缀。

原先挂在 Gin `/swagger/*any` 或 group 上的认证不会自动覆盖新外层 UI。
需要把自有中间件移到最终 Handler 外层，或使用[内置 Basic Auth](./deployment.md#basic-auth-与保护范围)。
`BasicAuth`、`Disabled`、`Specs`、`UISettings` 和 `Documents` 从 `v0.10.0` 起可用；
旧版消费者需先升级再使用这些配置。完整定义见[配置参考](./configuration.md)。

`Specs` 是静态命名 URL 列表，不转换 Swagger 2，不提供服务发现或文档代理。
多服务场景也应分别确认 spec 服务的鉴权与浏览器 CORS。

## 迁移验收

- 文档为支持版本的 OpenAPI JSON，宿主确实提供配置中的每个 URL。
- 根路径或子路径的 `doc.html`、静态资源及 Worker 可加载。
- 原有文档认证已经迁到外层，或使用内置文档认证。
- Try-it 命中预期业务 URL，参数、请求体和鉴权要求符合文档。
- 不需要文档时，停止挂载 UI，并停止注册宿主 spec 路由。
- 浏览器满足[兼容矩阵](../reference/compatibility.md#浏览器基线)，不把构建通过视为最低浏览器全部实机验收。
