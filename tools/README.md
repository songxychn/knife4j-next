# tools

验证、发布与任务看板脚本。与具体 LLM 产品解耦；编排不在此目录。

## 验证

| 脚本 | 作用 |
|---|---|
| `test-java.sh` | spotless + Maven verify + OAS3/OAS2 WebJar 冷热工作区回归 + smoke 证据 + Java 兼容契约 |
| `test-java-compatibility.sh` | 兼容报告与契约护栏的离线回归 |
| `java-compatibility-report.sh` | 对比显式 Central 基线并生成 report-first 的 Markdown / JSON / XML 报告 |
| `test-release-tools.sh` | Release 上下文、Central 构件与安全收尾脚本回归 |
| `smoke-evidence.sh`、`test-smoke-evidence.sh` | 由 `test-java.sh` 调用，按目录发现 smoke 模块并检查 surefire 证据；`--summary` 供 Build CI 输出表格 |
| `verify-configuration-metadata.sh` | 由 `test-java.sh` 调用，检查 starter JAR 内的 Spring Boot 配置元数据 |
| `test-front-core.sh` | schema-engine + core + React format/lint/test/build |
| `../front/scripts/check-bun.cjs` | OAS3 / Vue3 / docs / Knife4x UI 的统一 Bun 基线检查 |
| `test-vue3.sh` | Vue3 构建与产物检查 |
| `test-docs.sh` | Java/React 配置参考对照 + Go 文档契约/示例 + 站点构建/来源 + 站内链接、资源、锚点；需 JDK 17+、Python 3.9+、Go 1.22+ 和现有 Bun 基线 |
| `test-docs-deployment.sh` | 在 `test-java.sh` 后运行；用当前 WebJar 验证文档 Nginx、静态提取、Worker MIME、访问控制及实际 React JSON 发现；需 Docker、OpenSSL、unzip |
| `test-knife4x-go.sh` | Knife4x Go module 与 Gin 示例的 gofmt / vet / test；core/all 同时核对 Go 文档契约和示例 |
| `check-knife4x-docs.go`、`check-knife4x-docs_test.go` | 从 Go AST 校验公开字段、类型、可用版本，核对当前版本标记、安装命令、README 示例及本地链接；编译站点引用的源码示例，最小示例另按已发布兼容基线无 replace 编译 |
| `sync-knife4x-ui.sh` | 从共享前端源码生成 Knife4x 内嵌 UI；`--check` 只校验生成物一致 |
| `without-node.sh` | 隔离 PATH 中的独立 Node.js/npm，验证 Bun 工具链 |
| `test-all.sh` | java + 文档部署验收 + front-core + vue3 + docs + knife4x-go + `sync-knife4x-ui.sh --check` |
| `test-agent-status.sh` | 任务看板查询、过滤与失败路径 |
| `verify-current-version-docs.py`、`test-current-version-docs.sh` | 检查已跟踪 Markdown（不含 `legacy/`）中的 `com.baizhukui` 坐标、“示例使用 Java X”“当前源码版本”与发布说明“最新”标记是否等于 `knife4j/pom.xml` 版本，并检查文档解包脚本的 `knife4j_version`；包含相应回归；Build CI 的 `changes` job 每次运行 |

### CI 区域分类

`ci-changed-paths.sh` 计算 PR / push 的变更路径（无法可靠得出时失败，调用方回退全量），`ci-changes.sh`
把路径分类为 `java` / `react` / `vue3` / `docs` / `knife4x_go` 输出给 `build.yml`。对应回归为
`test-ci-changed-paths.sh` 与 `test-ci-changes.sh`。本地核对：

```bash
git diff --name-only <base>...<head> | ./tools/ci-changes.sh  # 三点：与 PR CI 一样按 merge-base 计算
```

### 文档保鲜与代码同步

配置参考表的字段名、声明类型和初始值从三个 `Knife4jSetting.java` 经 javac AST 提取；
React “读取默认值”列调用真实 `extractKnife4jSettings`，不维护第二份支持列表。
`docs/reference/settings-descriptions.json` 只维护解释文字；新增、删除字段必须同步解释。
源码更改后运行：

```bash
bun tools/docs/settings-reference.mjs --write
./tools/test-docs.sh
```

生成后必须审阅表格差异。默认只检查，不自动修复；无法识别的 Java 初始化表达式、新的
`Knife4jSetting` 实现会直接失败，需先审查检查器支持范围。`test-java.sh` 在编译后还会
实例化当前三个 bean，对照实际字段初值。这些检查不证明每个设置的 UI 功能已实现，
也不代替自由文字、兼容边界与安全语义的人工审阅。

`docs/snippets/` 是已纳入验证的关键示例的唯一维护位置，页面用 VitePress `<<<` 引用。
现有 Java smoke 直接加载 production/Basic YAML，验证实际保护与关闭增强后的行为；
Map 注解示例以当前依赖编译，语言示例用实际枚举转换；聚合测试验证 Nacos、Polaris、
连接池的严格绑定和 Polaris 启动条件。没有连接真实 Nacos/Polaris 服务。
部署验收直接执行文档解包脚本，使用固定官方 Nginx 镜像在无外网、无宿主端口的容器内
检查代理、多服务、静态部署以及三种保护策略；JSON 示例同时传给实际 React 发现与请求前缀函数。
新增示例时选择已有行为测试并直接引用原文件，不复制一份测试数据。

Java 源码及 OAS3 前端生产代码变化都会触发 `docs-build`；可执行文档示例和检查器变化
还会触发 Java 验证和文档部署验收。渲染后的链接检查覆盖整个站点的本地 `href/src/poster`
与 HTML fragment，忽略外部 URL，不访问网络，也不把 SPA 回退页面当作有效目标。
外链、CSS 内资源及所有文字叙述不在此静态检查范围。保留现有 Go 契约和当前版本门禁。

### Go 文档来源与边界

Go 用户手册只在 `docs/knife4x/` 维护。`knife4x/go/docs-version.json` 保存当前文档版本、
未发布的 Config 字段以及最小示例的已发布兼容基线；字段与类型从 Go AST 读取，UI 布尔
默认值按 Go JSON 标签对应到共享 `DEFAULT_SETTINGS`。该检查不会证明所有自由文本或安全
部署描述正确，仍需按实际源码审查。

`test-docs.sh` 会编译站内引用的标准库示例，且最小示例额外对已发布兼容基线无 `replace`
编译；它需要访问公共 Go module 服务。Gin 全文引用已有可运行示例，由 Go 的 all/gin 门禁
验证其独立工具链，不为文档另维护一份程序。版本历史不受“当前版本”检查覆盖。

每次站点构建写出 `build-info.json`：`sourceRevision` 是构建 checkout 的 SHA，
`sourceDirty` 标记相关源码是否含未提交内容，`knife4xVersion` 和
`exampleCompatibilityVersion` 来自版本元数据。部署后可读取该文件，并与本次部署的
已验证 SHA、版本及关键页面核对；本地构建或 CI 通过不表示线上已更新。
这次只增加来源信息，不改变现有站点托管或部署配置。

### Java 兼容性报告

`java-compatibility-report.sh` 在 `test-java.sh` 生成本地 JAR 后运行，默认把报告写到
`build/reports/java-compatibility/`。基线与 japicmp 版本固定在
`java-compatibility-baseline.properties`；发布模块沿用 `release-modules.txt`；`java-compatibility-summary.py`
把各模块 japicmp XML 汇总为 Markdown / JSON。

真实的二进制、源码兼容或实现/资源差异只进入报告，不令命令失败。Central 基线下载失败、
japicmp 执行失败、发布模块/产物异常，以及 `java-compatibility-contracts.tsv` 中登记的完整
Spring Boot 配置 key 或关键公开入口漂移会失败。japicmp 按单模块使用
`--ignore-missing-classes`，报告是维护信号，不替代消费方测试或人工审查。

配置元数据有意变化时，先完成评审和构建，再显式更新、核对差异：

```bash
./tools/verify-java-compatibility-contracts.py --update-config
./tools/verify-java-compatibility-contracts.py
```

## 发布

- `release-modules.txt`、`verify-release-modules.sh`：发布模块真相源及 BOM 一致性校验。
- `verify-release-context.sh`：校验 annotated `vX.Y.Z` tag、当前 checkout、POM 版本和发布说明一致。
- `verify-maven-central.sh`：按精确 URL 有界轮询公共 POM/JAR、签名和 SHA-1，并检查 UI JAR 可读取。
- `extract-release-note.sh`、`verify-github-release.sh`：生成并核对幂等 GitHub Release。

`verify-maven-central.sh` 默认最多检查 31 轮、每轮间隔 60 秒，只重试尚未通过的精确 URL 或 UI JAR 可读性检查；成功记录只在本次进程内有效。每轮输出失败文件及原因。测试或排障可设置 `MAVEN_CENTRAL_MAX_ATTEMPTS`、`MAVEN_CENTRAL_RETRY_INTERVAL_SECONDS`（可为 `0`）和 `MAVEN_CENTRAL_BASE_URL`，这些设置不改变制品完整性要求。

`demo-images/` — `publish-demo-images.yml` 使用的 Demo 镜像构建、验证与 `demo` 标签发布工具，契约见
[`demo-images/README.md`](demo-images/README.md)。

## 任务看板

`agent-status.sh` — 一次拉取 open `agent-task` 后按 status label 展示；`snapshot` 另含 git、当前 PR 与 checks。仓库依次取 `GH_REPO`、`GITHUB_REPOSITORY`、当前 `gh repo view`；查询失败时返回非零，不把失败显示为 `(none)`。

```bash
./tools/agent-status.sh snapshot
./tools/test-agent-status.sh
```

## 截图上传

`upload-images.sh` — 通过本机 PicGo / PicList 上传非敏感截图，验证公开链接并输出 Markdown。

```bash
./tools/upload-images.sh /absolute/path/before.png /absolute/path/after.png
```

## 架构探针

`test-json-schema-engine-spike.sh` — 运行 issue #683 的 JSON Schema 2020-12
语义、浏览器构建、CSP 与性能探针。该探针不接入产品运行时。

`test-oas31-resource-loader-spike.sh` — 运行 `spikes/oas31-resource-loader/` 的探针检查。

`assess-schema-example-search.mjs` — #949 的 Schema 示例生成算法对比评估，输出 JSON 报告，不修改产品源码。

`test-fixtures/` 为上述脚本回归使用的夹具，`spikes/` 为探针源码，二者均不接入产品运行时。
