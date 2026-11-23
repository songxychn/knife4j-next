# Knife4x

Knife4x 是面向 Go / Rust 宿主的进程内嵌入式 OpenAPI 3 文档与调试控制台。
Go 已发布，Rust 后置。UI 与 Java OAS3 共用 `front/ui-react` 和 `front/core`，
Go module、版本和发布流程独立，不另建前端。

公共库只依赖标准库 `net/http`，消费已有 OpenAPI 3 JSON，不生成 spec、不代理业务请求。
完整用户手册统一维护在[文档站](https://knife4jnext.com/knife4x/)，
仓库内可读[快速开始](../docs/knife4x/index.md)。

## 安装与体验

Go 1.22+ 接入版本为 `v0.10.2`（tag `knife4x/go/v0.10.2`）：

```bash
go get github.com/songxychn/knife4j-next/knife4x/go@v0.10.2
```

最小标准库程序见 [Go module README](go/README.md)。仓库内也可运行独立 Gin 示例
（Go 1.26+，其依赖不会进入公共库）：

```bash
cd knife4x/examples/gin
go run .
```

启动后打开 `http://localhost:8080/doc.html`。flags 和环境变量见
[Gin 示例说明](examples/gin/README.md)。`v0.10.0` 新增文档鉴权、多分组与 UI 配置，
可用版本与字段以[配置参考](../docs/knife4x/configuration.md)为准。

## 资料入口

- [配置参考](../docs/knife4x/configuration.md)
- [接入与部署](../docs/knife4x/deployment.md)
- [迁移指南](../docs/knife4x/migration.md)
- [版本记录](../docs/knife4x/releases.md)
- [源码验证与 UI 同步](go/README.md#源码开发与发布)
- [Go 发布清单](go/RELEASE.md)

本目录采用 [Apache-2.0](go/LICENSE) 许可证，产品需求与决策基线见
[issue #524](https://github.com/songxychn/knife4j-next/issues/524)。
