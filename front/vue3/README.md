# front/vue3

OAS2 兼容维护 UI（Vue 3 + Vite）。本目录产物被 `knife4j/knife4j-openapi2-ui` 打包为 webjar，供
`knife4j-openapi2-spring-boot-starter` 与 `knife4j-aggregation-spring-boot-starter` 使用。

> 关于职责边界：只接收 OAS2 / Swagger 2 侧的回归修复与显示层 bug 修复，**不做功能扩张**。新功能请求一律
> 指向 OAS3 主线 `front/ui-react`。详见 `.agent/PROJECT.md` 的「前端分工策略」一节。

## 包管理器

本目录使用 [Bun](https://bun.com/) 作为包管理器（基准版本见仓库根目录 `.bun-version`，依赖锁定见本目录
`bun.lock`）。Maven 构建也通过 bun 调用 vite，参见
`knife4j/knife4j-openapi2-ui/pom.xml` 中的 `exec-maven-plugin` 执行块。

## 浏览器与工具链基线

Vite 8.3.4 使用 Rolldown/Oxc 构建。JS 与 CSS 显式固定为 Chrome/Edge 117、Firefox 119、
Safari 17.4 及以上；这是 Java 5.7.9 相比 5.7.8 提高的 OAS2 Vue3 最低版本；OAS3 的独立要求见[兼容矩阵](../../docs/reference/compatibility.md#浏览器基线)。
Mermaid 12 使用新的默认主题、外观和 ELK 布局；其解析依赖需要原生 `Object.groupBy`，上述浏览器下限覆盖该 API。
源码开发、构建与验证要求 Node `^24.15.0 || >=26.0.0`（不支持 Node 25）。
CI 持续验证精确下限 24.15.0 及 24 系列当前补丁。日常推荐使用受支持 LTS 的最新补丁，`.nvmrc` 选择 24 系列。
`dev`、`build`、四发行模式、`preview` 和标准验证脚本会先检查 Node；Maven 调用相同的构建命令。
该下限适用于本模块及包含其产物的完整源码构建；使用已发布 WebJar 的 Java 应用无需安装 Node，
独立 OAS3/Go 模块的要求见 `.agent/RUNBOOK.md`，不随本次调整。

## 本地开发

```bash
cd front/vue3
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

修改本目录 Vue3 / OAS2 UI 后，优先从仓库根目录运行：

```bash
./tools/test-vue3.sh
```

该脚本会进入 `front/vue3/`，先检查 Node 版本，再执行 `bun install --frozen-lockfile` 与 `bun run build:Knife4jSpringUi`，
并检查 `dist/doc.html`、`dist/webjars/`、`dist/webjars/oauth/oauth2.html` 是否生成。
随后通过 Node VM ES modules 与 jsdom 执行实际构建 JS，在根目录和 `/demo/` 子路径下验证
Springfox 分组/Swagger2 请求、desktop gateway header 与文档初始化；夹具符合 Swagger 2.0。
Java smoke 对 `target/classes/META-INF/resources` 使用同一行为脚本，继续检查 doc.html 引用的资源完整性。
该测试不依赖压缩后的变量名或 switch 格式；隔离 DOM 不代替真实浏览器布局和最低版本验收。

修改 Java 模块或本目录产物集成逻辑后，还需运行：

```bash
./tools/test-java.sh
```
