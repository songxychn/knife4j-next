# tools

仓库验证、CI 路径分类与发布辅助脚本。

## 验证脚本

| 脚本 | 作用 |
|---|---|
| `test-java.sh` | Spotless + Maven `verify` + OAS3/OAS2 WebJar 回归 + smoke 测试证据 |
| `smoke-evidence.sh` | 按 `knife4j-smoke-tests/*/pom.xml` 发现 smoke 模块并核对 surefire 报告；`--summary` 输出 CI 表格 |
| `test-front-core.sh` | `schema-engine` + `core` + `ui-react` format / lint / test / build |
| `test-vue3.sh` | Vue3（OAS2 UI）构建与产物检查 |
| `test-docs.sh` | VitePress 文档站构建（含内置死链检查） |
| `test-knife4x-go.sh` | Knife4x Go module 与 Gin 示例的 `gofmt` / `go vet` / `go test` |
| `sync-knife4x-ui.sh` | 从共享 React 前端生成 Knife4x 内嵌 UI；`--check` 仅校验一致 |
| `test-all.sh` | 顺序执行上述全区域验证 |

## CI 与版本检查

- `ci-changed-paths.sh` / `ci-changes.sh`：计算 PR/push 变更路径并映射为 `java` / `react` / `vue3` / `docs` / `knife4x_go`。
- `verify-current-version-docs.py`：校验当前入口 Markdown 与解包脚本中的 Java Maven 坐标与 `knife4j/pom.xml` 一致。

## 发布脚本

- `release-modules.txt` / `verify-release-modules.sh`：发布模块清单及 BOM 一致性校验。
- `verify-release-context.sh`：校验 annotated `vX.Y.Z` tag、POM 版本与发布说明一致。
- `verify-maven-central.sh`：轮询校验公开 Maven Central 构件完整性。
- `extract-release-note.sh` / `verify-github-release.sh`：抽取并核对 GitHub Release 正文。

## 截图上传

- `upload-images.sh`：调用本机 PicGo / PicList 上传非敏感截图并输出 Markdown。
