# OAS 3.2 规范夹具（非生成器输出）

本目录是 #783 的**合成规范夹具**，不是 springdoc 或任何 Java 生产依赖生成的 `/v3/api-docs`。

- 规范正文：<https://spec.openapis.org/oas/v3.2.0.html>
- 固定结构 helper：<https://spec.openapis.org/oas/3.2/schema/2025-11-23>
- 方言 URI：`https://spec.openapis.org/oas/3.2/dialect/2025-09-17`
- 对照的真实生成器快照仍在 `front/ui-react/src/test-fixtures/springdoc-oas31/`，当前 POM 为 springdoc `1.8.0` / `2.8.9` / Boot4 `3.0.3`，输出 OpenAPI 3.0.x / 3.1.x。把那些文件的 `openapi` 字段改成 `3.2.0` **不能**当作真实 3.2 生成证据。

`host-acceptance-3.2.0.json` 覆盖宿主验收需要的合法 3.2 对象：QUERY、`additionalOperations`、嵌套 tags、querystring、cookie style、SSE `itemSchema`、未知媒体类型、`discriminator.defaultMapping`、XML `nodeType`、Webhook、Device Authorization，以及一条默认拒绝的外部 `$ref`。域名使用保留的 `example.test` / `knife4j.example`，测试不得请求真实第三方。

用户文档最小夹具见 `docs/public/examples/openapi-3.2-minimal.json` 与对应 YAML，语义与本目录一致但更短。
