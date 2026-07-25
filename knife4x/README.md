# Knife4x

Knife4x 是面向 Go / Rust 宿主的进程内嵌入式 OpenAPI 3 文档与调试控制台。
当前先交付 Go，Rust 后置。

## 定位

- 只消费标准 OpenAPI 3 JSON 文档，不生成 spec，不支持 OAS2 / Swagger 2
- Go 核心只依赖标准库 `net/http`，不绑定 Gin、Echo、Chi 等 Web 框架
- 与 Java 线 `knife4j-next` 同仓并共用 `front/ui-react` 与 `front/core`，但 module、版本和发布流程独立于 Java `5.x`
- 宿主壳只负责嵌入静态 UI、注入配置和挂载路由，不复制前端业务逻辑

Go module 路径为：

```text
github.com/songxychn/knife4j-next/knife4x/go
```

Go 首个公开版本固定为 `v0.1.0`，对应仓库 tag `knife4x/go/v0.1.0`。tag 发布前可从
仓库 checkout 直接运行 [Gin example](examples/gin/README.md)；发布状态与完整验收步骤见
[Go 发布清单](go/RELEASE.md)。

## 快速开始

先阅读 [Go 接入说明](go/README.md)。它先给出框架无关的 `http.Handler`
用法，再说明如何组合 Gin。

仓库内可直接运行：

```bash
cd knife4x/examples/gin
go run .
```

然后打开 <http://localhost:8080/doc.html>。子路径示例：

```bash
go run . -base-path /internal
```

此时入口为 <http://localhost:8080/internal/doc.html>。`BasePath` 只表示文档挂载前缀，
不会成为业务 API base URL。

从 `gin-swagger` 切换前，请先阅读
[迁移说明](go/MIGRATING_FROM_GIN_SWAGGER.md)：Knife4x 只接受 JSON 顶层
`openapi: 3.x` 的文档，不能直接加载 Swagger 2 / OAS2。

## 当前目录

```text
knife4x/
  go/          # Go module：embed UI + net/http Handler
  rust/        # Rust crate 占位，Go MVP 完成后再实现
  examples/
    gin/       # 可运行的 Gin 组合示例
    axum/      # 后置占位
```

## 配置与边界

Go Handler 的公开配置只有 `SpecURL` 与 `BasePath`。默认入口是 `/doc.html`；
关闭文档的方式是不创建或不挂载 Handler。Knife4x 不依赖 Java 的 discovery
端点，也不提供 `enabled`、`persistAuth`、`title` 或 `tryIt` 等宿主配置字段。

内嵌 UI 只能通过 `tools/sync-knife4x-ui.sh` 从共享前端源码生成，禁止手工修改
`knife4x/go/internal/ui/static/`。

本目录与 Java 主线同样采用 [Apache-2.0](go/LICENSE) 许可证（SPDX 标识：
`Apache-2.0`），但 module、版本与发布流程相互独立。产品需求与决策基线见
[issue #524](https://github.com/songxychn/knife4j-next/issues/524)。
