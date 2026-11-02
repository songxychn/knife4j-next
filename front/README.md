# front

活跃前端源码根目录。

Bun 的 CI / 发布基准版本见仓库根目录 `.bun-version`。本地可先使用现有 Bun 运行对应标准验证；无需仅因版本字符串不同而自动下载安装其他版本。

| 子目录 | 说明 | 产物 |
|---|---|---|
| `core/` | TypeScript 解析 / 调试核心（package name: `knife4j-core`） | 供 `ui-react` 依赖 |
| `schema-engine/` | JSON Schema 2020-12 / OAS 3.1 Schema 适配层（package name: `knife4j-schema-engine`） | 供 `ui-react` 依赖，见 [`schema-engine/README.md`](schema-engine/README.md) |
| `ui-react/` | OpenAPI 3 主线 UI（package name: `knife4j-ui-react`） | `knife4j-openapi3-ui` webjar；Knife4x Go 内嵌 UI（经 `tools/sync-knife4x-ui.sh` 生成） |
| `vue3/` | OpenAPI 2 / Swagger 2 兼容 UI（独立 bun 工程） | `knife4j-openapi2-ui` webjar |

`front/package.json` 的 `workspaces` 是 OAS3 workspace 成员的唯一来源；本目录只使用 Bun。

## OAS3 workspace（core + schema-engine + ui-react）

```bash
cd front
bun install --frozen-lockfile
bun run --filter knife4j-ui-react dev
```

仓库根验证：

```bash
./tools/test-front-core.sh
```

OAS3 的 core、schema-engine 和 ui-react 使用官方双别名：`@typescript/native`
固定为 TypeScript 7.0.2，`typescript` 指向 `@typescript/typescript6` 6.0.2
兼容包（锁文件固定其实际 TypeScript API 为 6.0.3）。生产编译与 Go 资源同步
统一调用 `scripts/tsc.cjs`，通过原生包的导出 manifest 定位 TS7 CLI。
ESLint 和 ts-jest 继续加载 `typescript` 的 TS6 API，保留现有规则、转换和诊断；
这部分不获得原生编译器的提速。不要把 ts-jest 的 compiler 改为原生包。
方案见 [TypeScript 7 官方公告](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)。

```bash
cd front
node scripts/tsc.cjs --version # TS7 生产编译器
node -p "require('typescript').version" # lint/Jest 使用的 TS6 API
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
