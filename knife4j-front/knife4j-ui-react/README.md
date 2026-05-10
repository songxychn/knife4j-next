# knife4j-ui-react

`knife4j-ui-react` 是 `knife4j-next` 的 OpenAPI 3.x 主线前端，使用 React + Vite + Ant Design 构建，并打包进 `knife4j-openapi3-ui` webjar，最终通过 `doc.html` 暴露给 OpenAPI3 starter。

它不是通用 Vite 模板，也不是 OAS2 兼容 UI。OAS2 兼容维护线在 `knife4j-vue3`。

## 本地开发

从 `knife4j-front/` workspace 根目录运行：

```bash
bun install --frozen-lockfile
bun run --filter knife4j-ui-react dev
```

## 验证命令

```bash
bun run --filter knife4j-ui-react format:check
bun run --filter knife4j-ui-react test
bun run --filter knife4j-ui-react build
bun run --filter knife4j-ui-react lint
```

涉及 `knife4j-front/**` 的改动，优先从仓库根目录运行统一脚本：

```bash
./scripts/test-front-core.sh
```
