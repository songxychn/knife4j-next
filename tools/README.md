# tools

验证、发布与任务看板脚本。与具体 LLM 产品解耦；编排不在此目录。

## 验证

| 脚本 | 作用 |
|---|---|
| `test-java.sh` | spotless + Maven verify + smoke 证据 |
| `test-front-core.sh` | core + React format/lint/test/build |
| `test-vue3.sh` | Vue3 构建与产物检查 |
| `test-docs.sh` | 文档站构建 |
| `test-all.sh` | java + front-core + vue3 + docs |

## 发布

`release-modules.txt`、`verify-release-modules.sh`、`extract-release-note.sh`、`verify-github-release.sh` — 由 release/build workflow 使用。

## 任务看板

`agent-status.sh` — 按 label 列 agent-task；`snapshot` 含 git / PR。

```bash
./tools/agent-status.sh snapshot
```
