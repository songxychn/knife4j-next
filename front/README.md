# front

活跃前端源码根目录。

| 子目录 | 说明 | 产物 |
|---|---|---|
| `core/` | TypeScript 解析 / 调试核心（package name: `knife4j-core`） | 供 `ui-react` 依赖 |
| `ui-react/` | OpenAPI 3 主线 UI（package name: `knife4j-ui-react`） | `knife4j-openapi3-ui` webjar；未来亦供 Knife4x embed |
| `vue3/` | OpenAPI 2 / Swagger 2 兼容 UI（独立 bun 工程） | `knife4j-openapi2-ui` webjar |

## OAS3 workspace（core + ui-react）

```bash
cd front
bun install --frozen-lockfile
bun run --filter knife4j-ui-react dev
```

仓库根验证：

```bash
./tools/test-front-core.sh
```

## OAS2（vue3）

```bash
cd front/vue3
bun install --frozen-lockfile
bun run dev
```

```bash
./tools/test-vue3.sh
```

历史 Vue 2 源码见 `legacy/vue2/`，不再参与构建。
