# tools

验证、发布与任务看板脚本。与具体 LLM 产品解耦；编排不在此目录。

## 验证

| 脚本 | 作用 |
|---|---|
| `test-java.sh` | spotless + Maven verify + smoke 证据 + Java 兼容契约 |
| `test-java-compatibility.sh` | 兼容报告与契约护栏的离线回归 |
| `java-compatibility-report.sh` | 对比显式 Central 基线并生成 report-first 的 Markdown / JSON / XML 报告 |
| `test-release-tools.sh` | Release 上下文、Central 构件与安全收尾脚本回归 |
| `test-front-core.sh` | core + React format/lint/test/build |
| `test-vue3.sh` | Vue3 构建与产物检查 |
| `test-docs.sh` | 文档站构建 |
| `test-all.sh` | java + front-core + vue3 + docs |
| `test-agent-status.sh` | 任务看板查询、过滤与失败路径 |

### Java 兼容性报告

`java-compatibility-report.sh` 在 `test-java.sh` 生成本地 JAR 后运行，默认把报告写到
`build/reports/java-compatibility/`。基线与 japicmp 版本固定在
`java-compatibility-baseline.properties`；发布模块沿用 `release-modules.txt`。

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

`verify-maven-central.sh` 默认最多检查 31 次、每次间隔 60 秒；测试或故障排查可通过 `MAVEN_CENTRAL_MAX_ATTEMPTS`、`MAVEN_CENTRAL_RETRY_INTERVAL_SECONDS` 和 `MAVEN_CENTRAL_BASE_URL` 收紧边界。

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
