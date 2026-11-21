# tools

验证、发布与任务看板脚本。与具体 LLM 产品解耦；编排不在此目录。

## 验证

| 脚本 | 作用 |
|---|---|
| `test-java.sh` | spotless + Maven verify + 配置元数据与 smoke 证据门禁 |
| `test-front-core.sh` | `front/core` + `front/ui-react` format/lint/test/build |
| `test-vue3.sh` | Vue3（OAS2 UI）构建与产物检查 |
| `test-docs.sh` | VitePress 文档站构建 |
| `test-knife4x-go.sh` | Knife4x Go 模块与 Gin 示例格式/vet/单测 |
| `sync-knife4x-ui.sh` | 同步或校验（`--check`）Knife4x Go 嵌入的 React UI 产物 |
| `test-all.sh` | 依次运行以上全部验证与资产同步校验 |
| `test-ci-changes.sh` | 校验 `ci-changes.sh` 的 CI 路径分类规则 |

## 发布与清单

- `smoke-modules.txt` — Java smoke-tests 模块清单（`test-java.sh` 与 `.github/workflows/build.yml` 共用）
- `release-modules.txt`、`verify-release-modules.sh`、`verify-configuration-metadata.sh`、`extract-release-note.sh`、`verify-github-release.sh` — 由 CI 与发布 workflow 使用

## 任务看板

`agent-status.sh` — 按 label 列 `agent-task`；`snapshot` 含 git / PR。

```bash
./tools/agent-status.sh snapshot
```

## 截图上传

`upload-images.sh` — 通过本机 PicGo / PicList 上传非敏感截图，验证公开链接并输出 Markdown。

```bash
./tools/upload-images.sh /absolute/path/before.png /absolute/path/after.png
```
