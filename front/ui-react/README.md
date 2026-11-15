# knife4j-ui-react

`knife4j-ui-react` 是 `knife4j-next` 的 OpenAPI 3.x 主线前端，使用 React + Vite + Ant Design 构建，并打包进 `knife4j-openapi3-ui` webjar，最终通过 `doc.html` 暴露给 OpenAPI3 starter。

它不是通用 Vite 模板，也不是 OAS2 兼容 UI。OAS2 兼容维护线在 `front/vue3`。

## 浏览器要求（当前源码）

React UI 最低要求 Chrome / Edge 112、Firefox 116、Safari / iOS Safari 17，
适用于 OAS3 WebJar 和复用同一 UI 的 Knife4x。JSONPath 11 使用原生 `RegExp` 的 `v` 标志，
构建不会为旧浏览器补齐该能力。升级前请确认浏览器版本；已发布版本的历史要求不变。

源码开发、构建和测试与 Vue3、文档站及 Knife4x UI 同步统一使用稳定 Bun `>=1.4.4 <1.5.0`，
无需安装 Node.js；CI 基准见根目录 `.bun-version`，同时验证 1.4 系列当前补丁。
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

## 测试注意事项

React 的两个 Vitest project 保留原有发现规则与隔离，共享最多两个 worker，限制 Bun 下多个 jsdom/React 文件的并行负载。`Accessibility.integration.test.tsx` 与 `ApiDebug.i18n.integration.test.tsx` 在 Linux 上执行真实元规范校验和页面渲染，文件级 runner watchdog 使用 60 秒；其他文件沿用 Vitest 默认值。全部断言、Schema 产品任务预算与取消边界保持，不以此声明性能提升。unit project 的 `src/test/webPlatformSetup.ts` 使用 npm Undici，并修正 Bun 1.4 的 Blob/File MIME getter 差异，保留原生对象 URL；现有 MIME、multipart 与流进度断言不变。integration project 继续使用 jsdom。上述适配只进入测试进程，不进入页面或生产构建。

Vitest 5 升级显式保留 `clearMocks:false`，React 的两个 inline project 还保留 `extends:false`，以维持原来的 mock 历史及配置隔离。参数化用例中的字符串标签不再自动带单引号；`-t` 跨 suite 的完整名称使用 ` > ` 分隔，手工筛选时可匹配单段名称或用通配正则连接各段。`vitest list` 默认静态解析，不能用它的条目数核对运行时参数化用例；需要完整集合时使用 `vitest list --no-staticParse --json`。标准测试命令、测试源码、断言和发现规则不随框架升级修改。
