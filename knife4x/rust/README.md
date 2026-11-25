# Knife4x for Rust

Knife4x 将 Knife4j Next 的 OpenAPI 3 控制台编入 Rust 服务。它从宿主提供的 JSON 加载文档，浏览器可直接调试业务 API。构建和部署应用只需 Rust 工具链；框架无关的核心可单独使用，Axum 适配通过 `axum` feature 启用。

## 安装

在 Axum 项目目录执行：

```bash
cargo add knife4x@0.12.0 --features axum
```

只使用框架无关核心时，执行 `cargo add knife4x@0.12.0`。

## 在仓库内体验

从仓库根目录运行：

```bash
cargo run --locked --manifest-path knife4x/examples/axum/Cargo.toml
```

打开 <http://127.0.0.1:8080/doc.html>，选择 `GET /api/ping` 并发送请求。示例用 utoipa 生成 `/openapi.json`。已有 JSON 端点的应用可直接传其 URL。

```rust
use knife4x::{axum::mount, Knife4xConfig};

let docs = Knife4xConfig::new("/openapi.json").base_path("/internal");
let app = mount(app, docs)?;
```

先注册 JSON 和业务路由，再调用 `mount`；此例的文档入口是 `/internal/doc.html`。文档访问鉴权以及迁移方法见[用户手册](https://knife4jnext.com/knife4x/rust)。

源码、示例和手册可以从[项目仓库](https://github.com/songxychn/knife4j-next)取得，发布验收见仓库内 `knife4x/rust/RELEASE.md`。
