# knife4j-vue3

OAS2 兼容维护 UI（Vue 3 + Vite）。本目录产物被 `knife4j/knife4j-openapi2-ui` 打包为 webjar，供
`knife4j-openapi2-spring-boot-starter` 与 `knife4j-aggregation-spring-boot-starter` 使用。

> 关于职责边界：只接收 OAS2 / Swagger 2 侧的回归修复与显示层 bug 修复，**不做功能扩张**。新功能请求一律
> 指向 OAS3 主线 `knife4j-front/knife4j-ui-react`。详见 `.agent/PROJECT.md` 的「前端分工策略」一节。

## 包管理器

本目录使用 [Bun](https://bun.com/) 作为包管理器（见 `package.json` 里的 `packageManager: "bun@1.3.13"` 与根目录
`bun.lock`）。Maven 构建也通过 bun 调用 vite，参见
`knife4j/knife4j-openapi2-ui/pom.xml` 中的 `exec-maven-plugin` 执行块。

## 本地开发

```bash
cd knife4j-vue3
bun install --frozen-lockfile
bun run dev
```

## 构建

```bash
bun run build
```

构建产物默认写入 `dist/`。在 Maven 流水线里，`knife4j-openapi2-ui` 模块会通过 `--outDir` 把产物重定向到
`knife4j/knife4j-openapi2-ui/target/knife4j-vue3-dist`，再由 `maven-resources-plugin` 拷贝到
`META-INF/resources/`（`doc.html`、`webjars/`、`img/icons/`）。

## 与 Java 模块的集成

下游 starter 通过 Maven 依赖 `knife4j-openapi2-ui` 来获取 webjar：

| Starter | 是否打包本目录产物 |
|---|---|
| `knife4j-openapi2-spring-boot-starter` | ✅（依赖 `knife4j-openapi2-ui`） |
| `knife4j-aggregation-spring-boot-starter` | ✅（依赖 `knife4j-openapi2-ui`） |
| `knife4j-aggregation-jakarta-spring-boot-starter` | ❌（使用 `knife4j-openapi3-ui`，即 React UI） |

## 验证命令

修改 Java 模块或本目录产物集成逻辑后，至少运行：

```bash
./scripts/test-java.sh
```

（本目录自身暂未纳入 `./scripts/test-front-core.sh`；若纯改 `knife4j-vue3/src/**` 且未触碰 Java 集成，
可本地 `bun run build` 验证后再推进 CI。）
