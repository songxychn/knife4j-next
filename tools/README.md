# tools

验证、发布与任务看板脚本。与具体 LLM 产品解耦；编排不在此目录。

## 验证

| 脚本 | 作用 |
|---|---|
| `test-java.sh` | spotless + Maven verify + smoke 证据 |
| `test-release-tools.sh` | Release 上下文、Central 构件与安全收尾脚本回归 |
| `test-front-core.sh` | core + React format/lint/test/build |
| `test-vue3.sh` | Vue3 构建与产物检查 |
| `test-docs.sh` | 文档站构建 |
| `test-all.sh` | java + front-core + vue3 + docs |

## 发布

- `release-modules.txt`、`verify-release-modules.sh`：发布模块真相源及 BOM 一致性校验。
- `verify-release-context.sh`：校验 annotated `vX.Y.Z` tag、当前 checkout、POM 版本和发布说明一致。
- `verify-maven-central.sh`：按精确 URL 有界轮询公共 POM/JAR、签名和 SHA-1，并检查 UI JAR 可读取。
- `extract-release-note.sh`、`verify-github-release.sh`：生成并核对幂等 GitHub Release。

`verify-maven-central.sh` 默认最多检查 31 次、每次间隔 60 秒；测试或故障排查可通过 `MAVEN_CENTRAL_MAX_ATTEMPTS`、`MAVEN_CENTRAL_RETRY_INTERVAL_SECONDS` 和 `MAVEN_CENTRAL_BASE_URL` 收紧边界。

## 任务看板

`agent-status.sh` — 按 label 列 agent-task；`snapshot` 含 git / PR。

```bash
./tools/agent-status.sh snapshot
```

## 截图上传

`upload-images.sh` — 通过本机 PicGo / PicList 上传非敏感截图，验证公开链接并输出 Markdown。

```bash
./tools/upload-images.sh /absolute/path/before.png /absolute/path/after.png
```

## 架构探针

`test-json-schema-engine-spike.sh` — 运行 issue #683 的 JSON Schema 2020-12
语义、浏览器构建、CSP 与性能探针。该探针不接入产品运行时。
