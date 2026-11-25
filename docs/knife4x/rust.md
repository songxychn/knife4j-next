---
title: Knife4x Rust
description: 在 Rust 服务中嵌入 Knife4j OpenAPI 3 控制台，使用 Axum 挂载文档和访问保护。
---

# Knife4x Rust

Rust crate 将共享 React UI 编入服务的二进制文件。应用负责提供 OpenAPI 3 JSON；浏览器加载页面、读取文档并直接请求业务接口。目前可以从源码接入，首个 crates.io 版本将在双端发布时提供。

## 运行 Axum 示例

在仓库根目录运行：

```bash
cargo run --locked --manifest-path knife4x/examples/axum/Cargo.toml
```

打开 `http://127.0.0.1:8080/doc.html`，在 `GET /api/ping` 的调试页发送请求。示例通过 utoipa 生成文档，在 `/openapi.json` 提供 JSON。使用其他生成器或已有静态 JSON 时，也可以传入相同的 URL。示例支持用 `KNIFE4X_ADDR` 更改监听地址、用 `KNIFE4X_BASE_PATH` 设置前缀，同时设置 `KNIFE4X_BASIC_USER` 和 `KNIFE4X_BASIC_PASSWORD` 可开启文档访问认证。

在自己的 Cargo 项目中使用本地源码时，把路径替换为实际检出位置：

```toml
[dependencies]
knife4x = { path = "../knife4j-next/knife4x/rust", features = ["axum"] }
```

对已经注册好业务接口和文档 JSON 的 Axum Router，最后一步是挂载控制台：

```rust
use knife4x::{axum::mount, Knife4xConfig};

let docs = Knife4xConfig::new("/openapi.json").base_path("/internal");
let app = mount(app, docs)?;
```

打开 `/internal/doc.html`。这里的 `/openapi.json` 从网站根路径加载；若写成 `openapi.json`，浏览器会访问 `/internal/openapi.json`。把文档挂载在子路径时，只需设置一次 `base_path`。业务请求地址遵循 OpenAPI 的 `servers` 与接口路径。

## 配置

| API | 用法 |
|---|---|
| `Knife4xConfig::new(url)` | 单个 OpenAPI JSON URL，支持相对、根相对与完整 HTTP(S) 地址 |
| `Knife4xConfig::from_specs(...)` | 有序命名分组，每项包含唯一名称和 URL |
| `base_path(...)` | 文档和资源的挂载前缀，默认为根路径 |
| `basic_auth(...)` | 可选文档访问认证，默认关闭。启用时用户名和密码均必填，realm 默认 `Knife4x` |
| `ui_settings(...)` | 为语言、搜索、调试、原始 OpenAPI、请求缓存、接口变化提示、模型、文档管理、分组、首页与页脚设置默认值 |
| `documents(...)` | 各分组共享的附加 Markdown，可用 `include_str!("guide.md")` 将正文随应用发布 |

下面的配置按顺序展示两个分组，默认关闭搜索，并把项目里的说明作为附加文档嵌入：

```rust
use knife4x::{Knife4xConfig, MarkdownDocument, Spec, UiSettings};

let docs = Knife4xConfig::from_specs([
    Spec::new("用户", "/spec/users.json"),
    Spec::new("订单", "/spec/orders.json"),
])
.ui_settings(UiSettings {
    enable_search: Some(false),
    ..UiSettings::default()
})
.documents([MarkdownDocument::new("接入说明", include_str!("guide.md"))]);
```

UI 布尔配置使用 `Option<bool>`。`None` 沿用共享默认值，`Some(false)` 显式关闭。配置覆盖顺序从低到高依次为共享 UI、Rust 宿主、文档扩展、浏览器本地选择。启停由应用决定；需要完全关闭文档时，在同一个环境条件内注册 UI 和本地 JSON 路由。

### Basic Auth

```rust
use knife4x::{axum::mount, BasicAuth, Knife4xConfig};

let auth = BasicAuth::new(
    std::env::var("DOCS_USERNAME")?,
    std::env::var("DOCS_PASSWORD")?,
)?;
let docs = Knife4xConfig::new("/openapi.json")
    .base_path("/internal")
    .basic_auth(auth);
let app = mount(app, docs)?;
```

先组装包含本地 JSON 的完整 Router，再交给 `mount`。此例中 `/internal/doc.html`、内嵌静态资源和 `/openapi.json` 都要求认证，缺少有效凭据时返回 401。密码仅留在服务端，公开部署使用 HTTPS。绝对 HTTP(S) 文档 URL 由目标端自行保护；业务 API 使用其原有认证方案。

### 从 utoipa-swagger-ui 迁移

保留 `#[utoipa::path]`、`ToSchema` 和已有业务路由。如果原先由 `SwaggerUi::url(...)` 同时提供 JSON，换 UI 时要显式保留相同的 JSON 地址。用 `utoipa_axum` 的应用可通过 `split_for_parts()` 取出已有 Router 和文档，注册 JSON，再挂上 Knife4x。下面的示例函数把这三步放在一起。

<<< ../../knife4x/examples/axum/src/main.rs#app
