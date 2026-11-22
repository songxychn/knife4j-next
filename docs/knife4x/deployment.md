---
title: Go 接入与部署
---

# Go 接入与部署

本页示例使用 `v0.10.0`，包含 Basic Auth、`Disabled`、多分组及 UI/Markdown 配置。
安装与最小接入见[快速开始](./index.md)，完整字段见[配置参考](./configuration.md)。

## 标准库组合

先由宿主 Handler 提供 OpenAPI JSON 和业务路由，再把它作为 `next` 传给 `NewHandler`。
Knife4x 只处理自己的入口和内嵌资源，其他请求继续交给宿主；不会生成 spec、转发 API
或替换业务鉴权。完整标准库示例见[最小接入](./index.md#安装与最小接入)。

## 子路径与 URL 解析

| 配置 | 浏览器请求 |
| --- | --- |
| `BasePath: "/internal"` | `/internal/doc.html`，资源也位于 `/internal/` 下 |
| `SpecURL: "openapi.json"` | `/internal/openapi.json` |
| `SpecURL: "/openapi.json"` | `/openapi.json`，不拼接 BasePath |
| 完整 `https://...` spec URL | 直接请求该 URL，跨域时由目标服务提供 CORS |

`BasePath` 必须是干净的绝对路径，不能含查询、fragment、反斜线或 `..` 路径跳转。
它不是首页文件名，也不是业务 API base URL。业务请求继续遵循 OpenAPI `servers`；
不会因 UI 挂在 `/internal` 就把所有 API 加上该前缀。
多 spec 的两种本地路径示例见[分组配置](./configuration.md#spec)。

## Basic Auth 与保护范围

`BasicAuth` 为 nil 时默认关闭；配置后必须同时提供非空用户名与密码。
入口认证在外层 Knife4x Handler 执行，不是给业务请求设置的 OpenAPI 安全方案。

| 对象 | 内置 Basic Auth 行为 |
| --- | --- |
| 文档 `/doc.html` | 认证后访问 |
| 内嵌 JS、CSS、图片、Worker、动态分块、OAuth 回调 | 按文档挂载前缀保护 |
| 配置中的相对或根相对 spec URL | 对应本地路径及其子路径须认证；spec 为 `/` 时只匹配根路径。覆盖所有 HTTP 方法，query 不缩小范围 |
| 完整 HTTP(S) spec URL | 不自动保护，即使该 URL 恰好同源；目标服务自行认证 |
| 业务 API、未配置的 spec 别名 | 不由文档认证接管，宿主自行保护 |

认证匹配时会折叠重复斜线和点段，并兼容宿主自定义路由可能识别的反斜线和分号别名。
宿主仍收到原始请求。配置的 spec URL 禁止使用反斜线，编码点段则按浏览器 URL 解析规则处理后匹配本地路径。
这不能替代对任意宿主别名的检查。受保护响应使用 `Cache-Control: private, no-store`，
凭据不进入浏览器启动配置，不向远端 spec 转发，也不改变 spec 内容。

部署时使用 HTTPS 或可信 TLS 终止代理。文档认证不替代业务 API 的权限控制；
UI 中隐藏 Debug、菜单或模型也不构成访问保护。

## 完整关闭 UI 和 spec

`Config.Disabled: true` 会直接返回 `next`，不验证文档配置、不读取 Markdown，
也不再为宿主 spec 提供文档认证。宿主自己注册的 spec 仍需显式停止注册。
用同一个开关控制两者，才能关闭文档的 UI 和 JSON 入口：

<<< ./snippets/protected.go

此完整程序只有在 `DOCS_ENABLED=true` 时挂载 UI 和 spec，并要求
`DOCS_USERNAME` / `DOCS_PASSWORD` 两个环境变量均非空。关闭时 `/api/ping` 仍可用。
可由部署系统注入凭据，不要把真实密码写入源码、URL 或命令历史。

## Gin 与外层中间件

Gin engine 实现了 `http.Handler`，可以直接作为 `NewHandler` 的 `next`。
仓库内例子是独立 module，需要 Go 1.26+；公共库仍维持 Go 1.22：

```bash
cd knife4x/examples/gin
go run . -base-path /internal -multi-spec
```

实际可运行源码如下；其内嵌 JSON 和 Markdown 文件随示例目录提供：

<<< ../../knife4x/examples/gin/main.go

该示例在外层创建 Knife4x，内层注册 Gin 路由，请求顺序是
**外层中间件 → Knife4x → Gin**。仅对 `router.Use(...)` 或 Gin group 加鉴权，
保护不到已由外层返回的 UI 与资源。已有会话中间件若采用
`func(http.Handler) http.Handler` 签名，可以包住最终交给 `ListenAndServe` 的 Handler；
这样通常会保护整个服务，包括业务 API。若只保护文档，应在外层按文档和本地 spec
路径分派，并保留未知路由的宿主行为。

示例默认监听 `:8080`，可用 `-addr` 修改。`-base-path` 设置文档前缀，
`-multi-spec` 开启双分组，`-docs-enabled=false` 同时关闭 UI 和 spec。
通过部署环境同时设置 `KNIFE4X_BASIC_USER` / `KNIFE4X_BASIC_PASSWORD` 启用文档认证，
只设置其中一个会使示例启动失败；这两个变量均为空时不启用认证。

## 反向代理、Worker 与 CSP

代理应一起转发 UI 入口、静态资源、OAuth 回调、Worker、动态分块和本地 spec，
保留 `Authorization`，并让上游收到与 `BasePath` 一致的路径。
如果代理剥离前缀，必须同时设计浏览器资源 URL、spec URL 与上游挂载路径；
Knife4x 不会根据 `X-Forwarded-Prefix` 自动重写这些地址。

共享 UI 的 Schema Worker 是同源 ES module Worker：

- 保留完整构建资源，不只复制入口 JS/CSS；Worker 的动态分块也必须可访问。
- 返回正确 JavaScript MIME；不要让登录页或 SPA fallback 替代丢失的脚本。
- CSP 需允许同源模块和 `worker-src 'self'`，并授权 Go 启动页的内联配置脚本。
- 若用 CSP hash 授权内联脚本，按实际输出计算并随配置变更更新；Knife4x 不自动提供 nonce 注入配置。

Basic Auth 不会自动解决 CSP、跨域或脚本 MIME 问题。完整浏览器下限、Worker 与 CSP
要求见[兼容矩阵](../reference/compatibility.md#schema-worker-部署要求)和
[FAQ 的 Worker CSP](../guide/faq.md#schema-worker-csp)。

## 接入核对

- UI 入口和实际 spec URL 均可达；根相对与相对路径符合部署前缀。
- 开启文档认证时，未认证访问 UI、资源和本地 spec 被拒绝；业务鉴权按宿主策略验证。
- 关闭文档时，UI 和所有宿主 spec 路由一并关闭，而业务路由仍按原策略运行。
- Try-it 命中 OpenAPI `servers` 指向的业务 URL，所需 CORS 由业务服务提供。
- 浏览器能加载 Worker 与动态分块，没有 CSP、404 或 MIME 错误。
