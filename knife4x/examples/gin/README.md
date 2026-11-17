# Knife4x Gin example

Gin 提供业务 API 与已有 OpenAPI JSON，外层 Knife4x 提供文档 UI。
本示例需要 Go 1.26+；其独立 module 依赖不进入公共库的 Go 1.22 基线。
本地 `replace ../../go` 使用当前源码，演示 `v0.10.0` 的文档鉴权、多分组与 UI 配置。

在仓库根目录运行：

```bash
cd knife4x/examples/gin
go run .
```

打开 `http://localhost:8080/doc.html`；spec 为 `/openapi.json`，业务接口为 `/api/ping`。
示例只消费固定的 Springdoc OpenAPI 3.1 快照，不运行生成器。

子路径和双分组示例：

```bash
go run . -base-path /internal -multi-spec
```

入口为 `/internal/doc.html`，两组均显示内嵌的“接入说明”。
完整 flags、凭据环境变量、关闭方式与接入层级统一见
[文档站部署指南](../../../docs/knife4x/deployment.md#gin-与外层中间件)。
配置与迁移说明见 [Go 用户手册](../../../docs/knife4x/index.md)，
在线入口为 [knife4jnext.com](https://knife4jnext.com/knife4x/)。
