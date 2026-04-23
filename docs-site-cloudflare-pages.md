# Cloudflare Pages 部署

`docs-site` 已按 `https://knife4jnext.com` 的正式域名场景完成了基础配置：

- VitePress `sitemap.hostname` 已设置为 `https://knife4jnext.com`
- 所有页面会生成 canonical 链接
- Open Graph / Twitter 分享地址已经切到正式域名
- `pages.dev` 与分支预览域会通过 `_headers` 返回 `X-Robots-Tag: noindex`

## Pages 项目设置

在 Cloudflare Pages 中导入当前 Git 仓库后，使用以下配置：

- Framework preset: `VitePress`
- Root directory: `docs-site`
- Production branch: `master`
- Build command: `npx vitepress build`
- Build output directory: `.vitepress/dist`

## 绑定域名

目标正式域名：

- `knife4jnext.com`

建议同时接入：

- `www.knife4jnext.com`

Cloudflare Pages 中先给项目添加 `knife4jnext.com` 自定义域名。因为这是 apex 域名，所以该域名需要已经接入 Cloudflare，并使用 Cloudflare nameservers。

## 推荐的额外规则

### 1. `www` 统一跳转到 apex

建议在 Cloudflare 的 Bulk Redirects 或 Redirect Rules 中添加：

- `https://www.knife4jnext.com/*` -> `https://knife4jnext.com/${1}`
- 状态码：`301`
- 保留 query string

### 2. `pages.dev` 跳转到正式域名

建议在 Cloudflare 的 Bulk Redirects 中添加：

- `<your-project>.pages.dev/*` -> `https://knife4jnext.com/${1}`
- 状态码：`301`
- 保留 query string

这样搜索引擎和用户都会收敛到正式域名。

## 本地验证

```bash
cd docs-site
npm install
npm run build
npm run preview
```
