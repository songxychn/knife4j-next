# Knife4x 示例

本示例只消费 OpenAPI JSON，不生成文档。Matrix 分组展示 Springdoc 固定快照；
开启多分组后，Ping 分组只展示 `/api/ping`。

文档 Basic Auth 保护文档资源和本地 spec；业务 API 需要自己的访问控制。
`-docs-enabled=false` 会同时停止挂载 UI 与两个 spec 路由。
