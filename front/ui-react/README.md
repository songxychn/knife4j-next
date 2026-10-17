# knife4j-ui-react

`knife4j-ui-react` 是 `knife4j-next` 的 OpenAPI 3.x 主线前端，使用 React + Vite + Ant Design 构建，并打包进 `knife4j-openapi3-ui` webjar，最终通过 `doc.html` 暴露给 OpenAPI3 starter。

它不是通用 Vite 模板，也不是 OAS2 兼容 UI。OAS2 兼容维护线在 `front/vue3`。

## 浏览器要求（当前源码，待发布）

React UI 最低要求 Chrome / Edge 112、Firefox 116、Safari / iOS Safari 17，
适用于 OAS3 WebJar 和复用同一 UI 的 Knife4x。JSONPath 11 使用原生 `RegExp` 的 `v` 标志，
构建不会为旧浏览器补齐该能力。升级前请确认浏览器版本；已发布版本的历史要求不变。

OAS2 Vue3 不受本次调整影响。Node 工具链范围仍为 `^22.13.0 || >=24.0.0`，
生产编译继续使用 TS7，ESLint / ts-jest 继续使用 TS6 API 别名。

## 本地开发

从 `front/` workspace 根目录运行：

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

涉及 `front/**` 的改动，优先从仓库根目录运行统一脚本：

```bash
./tools/test-front-core.sh
```
