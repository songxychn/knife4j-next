# tools

验证、发布与任务看板的通用脚本。与具体 agent 运行时（Claude / Codex / OpenClaw / 其他）解耦；编排逻辑放在 `.agent/` 与各自运行环境，不在此目录绑定某一 CLI 或消息通道。

## 验证

| 脚本 | 作用 |
|---|---|
| `test-java.sh` | `knife4j/` spotless + Maven verify + smoke 证据门禁 |
| `test-front-core.sh` | `front/` workspace：core + ui-react 的 format/lint/test/build |
| `test-vue3.sh` | `front/vue3` 构建，并检查 `doc.html` / webjars 产物 |
| `test-docs.sh` | 文档站构建 |
| `test-all.sh` | 依次跑 java、front-core、vue3、docs |

跨区域改动或准备大 PR 时用 `./tools/test-all.sh`。小改动请按 `.agent/RUNBOOK.md` 选最窄脚本。

### Smoke 模块列表

`smoke-modules.txt` 是 smoke 证据门禁的**唯一数据源**，被：

- `test-java.sh`
- `.github/workflows/build.yml` 的 summary 步骤

共同读取。新增或下线 smoke 模块只改该文件。

## 发布

| 脚本 / 文件 | 作用 |
|---|---|
| `release-modules.txt` | 发布构件清单 |
| `verify-release-modules.sh` | 清单 vs parent POM / BOM 一致性 |
| `extract-release-note.sh` | 从 docs release notes 抽取版本小节 |
| `verify-github-release.sh` | 校验 GitHub Release 存在且 body 一致 |

由 `.github/workflows/release.yml` 与 `build.yml` 调用。

## 任务看板

| 脚本 | 作用 |
|---|---|
| `agent-status.sh` | 按 label 列出 agent-task issue；`snapshot` 附带 git / PR 状态 |

仓库解析顺序：`GH_REPO` / `GITHUB_REPOSITORY` → `gh repo view` → `git origin`。

## 共享库

`common.sh` 提供 `read_list_file`、`ensure_java_home`、`resolve_github_repo` 等，供上述脚本 `source`，不要单独执行。

## 不再包含的内容

历史上存在的 `tools/claude/`（Claude Code + Telegram 专用编排）已移除。worker / reviewer 编排与通知通道由当前 agent 运行时自行处理，不在本目录固化。
