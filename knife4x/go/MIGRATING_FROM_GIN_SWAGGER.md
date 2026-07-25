# 从 gin-swagger 迁移

Knife4x 替换的是嵌入式文档与调试 UI，不替代 OpenAPI 生成器。

## 迁移前检查

先打开现有 JSON spec，检查顶层版本字段：

```json
{
  "openapi": "3.0.3"
}
```

只有 `openapi: 3.x` JSON 可以继续。若文档使用 `swagger: "2.0"`，请先升级生成器或转换
spec；OAS2 不能直接迁移到 Knife4x。

首个 Knife4x Go 版本尚未发布，因此现在不要把下面命令当成可用 release。发布后确认
release 页面已有公共版本，再执行：

```bash
go get github.com/songxychn/knife4j-next/knife4x/go@latest
```

## 替换挂载代码

典型的 `gin-swagger` 路由：

```go
router.GET("/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))
```

改为先由 Gin 提供已有的 OpenAPI 3 文档，再将整个 engine 交给 Knife4x：

```go
router := gin.New()
router.StaticFile("/openapi.json", "./openapi.json")
router.GET("/api/ping", servePing)

handler, err := knife4x.NewHandler(knife4x.Config{
	SpecURL: "/openapi.json",
}, router)
if err != nil {
	log.Fatal(err)
}
log.Fatal(http.ListenAndServe(":8080", handler))
```

并增加 import：

```go
import knife4x "github.com/songxychn/knife4j-next/knife4x/go"
```

启动后入口从 `/swagger/index.html` 变为 `/doc.html`。只有确认不再使用相关生成或
挂载能力后，才从 `go.mod` 和 imports 中移除 `gin-swagger`、`swaggerFiles` 等旧依赖。

## 子路径

需要把文档挂在 `/internal` 时：

```go
router.StaticFile("/internal/openapi.json", "./openapi.json")

handler, err := knife4x.NewHandler(knife4x.Config{
	SpecURL:  "openapi.json",
	BasePath: "/internal",
}, router)
```

入口为 `/internal/doc.html`，相对 spec 位于 `/internal/openapi.json`。业务 API
仍按 OpenAPI 文档的 `servers` 与 path 解析，不会自动拼接 `/internal`。

## 核对清单

- spec 顶层是 `openapi: 3.x`
- 宿主实际提供 `SpecURL` 指向的文档
- 根路径打开 `/doc.html`，或在子路径打开 `${BasePath}/doc.html`
- Try-it 请求命中预期业务 URL
- 生产环境不需要文档时，不创建或不挂载 Knife4x Handler

可运行参考见 [Gin example](../examples/gin/README.md)，完整配置语义见
[Go 接入说明](README.md)，产品边界见 [Knife4x 总览](../README.md)。
