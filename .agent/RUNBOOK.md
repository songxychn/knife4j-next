# 运行手册

使用与改动匹配的**最窄**验证。小改动不要默认跑全套。

## 环境

- Java：`.java-version`
- Node：`.nvmrc`
- 前端包管理：bun（`front/`、`front/vue3/`、`docs/`）
- CI：`.github/workflows/build.yml`、`release.yml`

## 验证命令

| 改动 | 命令 | 说明 |
|---|---|---|
| `knife4j/**` Java | `./tools/test-java.sh` | spotless + verify + smoke 证据门禁 |
| `front/core`、`front/ui-react` | `./tools/test-front-core.sh` | format / lint / test / build（对齐 CI） |
| `front/vue3` | `./tools/test-vue3.sh` | 构建并检查 `doc.html` / webjars |
| `docs/**` | `./tools/test-docs.sh` | 文档站构建 |
| 跨多区域 | `./tools/test-all.sh` | 依次跑上述（含 vue3） |

强制：

- 改前端源码时用对应脚本，不要用单独 `tsc` / `vite build` 冒充全量。
- Java 改动的 PR / issue 应能指向 smoke 证据：本地 `test-java.sh` 尾部 `Smoke-tests evidence OK`，或 CI 的 smoke summary。
- 增删 smoke 模块时同步更新 `tools/test-java.sh` 的 `SMOKE_MODULES` 与 `.github/workflows/build.yml` 中的 summary 列表（若仓库已抽出 `tools/smoke-modules.txt` 则只改该文件）。

## 上游 issue 复现（强制）

正文含 `Upstream: ...` 或标题带 `(upstream #N)` 时，**先复现再写修复**：

1. 读完 upstream 堆栈、触发条件、版本组合；缺信息 → 评论说明并 `status:blocked`。
2. 在 `knife4j-smoke-tests/` 复用或新建最小工程，**显式 pin** 相关版本。
3. 在未打补丁的 master 上复现，把证据贴 issue。
4. 复现不到：写明尝试条件；已修复则 close 并链 commit；否则 blocked。**禁止**空想 try-catch / null-guard。
5. 能复现：先写会失败的断言，再修，修后应变绿。

## PR 与 CI

`push` / 开 PR **不是**完成。完成后：

```bash
gh pr checks <N> --watch
```

CI 红：同分支修，再等。全绿且审查结论具备后，才标 `status:review`。

PR 至少写清：关联 issue、范围、验证命令与结果、风险。

## 正式发布验收

须维护者明确确认后再 tag。完成条件同时满足：

- `vX.Y.Z` tag 已推送
- `Release` workflow 成功
- `Build and Deploy Demo` workflow 成功
- Maven Central 目标构件可访问
- GitHub Release 存在且 body 与 `docs/release-notes/index.md` 对应小节一致

缺 GitHub Release 不得报「发布完成」。

## 验证失败时

1. 记录精确失败命令  
2. 判断是否本任务引入  
3. 超范围 → `status:blocked` 或后续 issue  
4. 不要为了“看起来完成”降低验证标准  
