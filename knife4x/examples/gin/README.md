# Knife4x Gin example

本示例让 Gin 作为业务 `http.Handler`，再由 Knife4x 的框架无关 Handler 同时提供文档资源。
它只消费现成的 OpenAPI 3 文档，不使用 `swag` 或 `gin-swagger` 生成 spec。

在本目录运行：

```bash
go run .
```

打开：

- Knife4x：<http://localhost:8080/doc.html>
- OpenAPI 3 fixture：<http://localhost:8080/openapi.json>
- 业务接口：<http://localhost:8080/api/ping>

子路径部署：

```bash
go run . -base-path /internal
```

此时文档入口为 <http://localhost:8080/internal/doc.html>，fixture 为
<http://localhost:8080/internal/openapi.json>；业务接口仍是
<http://localhost:8080/api/ping>，不会拼接文档挂载前缀。

本地 module 的 `replace ../../go` 仅用于 monorepo 开发，不是发布后的用户接入方式。
