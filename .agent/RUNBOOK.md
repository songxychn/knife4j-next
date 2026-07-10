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

## Bug 复现（强制）

凡 **bug / 回归 / 错误行为** 类任务（本仓 issue 或 upstream 关联），**先复现再写修复**。  
不适用于：纯文档、流程文案、明确的新功能、无行为主张的格式化/重构。

### 通用步骤

1. **读完问题描述**：堆栈、触发步骤、版本组合、期望 vs 实际；缺信息 → 评论说明并 `status:blocked`，不要猜。
2. **在未打补丁的 master（或任务指定的基线）上复现**，留下可核对证据（命令输出、HTTP 响应、日志片段、失败测试）。证据贴 issue 评论。
3. **复现手段按区域选择**（能自动化的优先自动化）：
   - Java / starter / 兼容：优先 `knife4j-smoke-tests/` 复用或新建最小工程；相关版本**显式 pin**；登记 smoke 列表（见上）。
   - `front/core`：失败单测或最小解析夹具。
   - UI：最小复现步骤 + 能固定的测试/断言；纯视觉问题至少写清浏览器与操作路径及截图/描述。
4. **复现不到**：写明已尝试条件；若历史已修则 close 并链 commit；否则 `status:blocked` 等补充信息。**禁止**空想 try-catch / null-guard /「防御性」补丁。
5. **能复现**：先增加（或确认）在修复前会失败的断言/复现步骤，再修；修后同一证据应变绿或现象消失。

### 额外：upstream 关联

正文含 `Upstream: ...` 或标题带 `(upstream #N)` 时，在上述步骤之外还须：

- 读完 upstream 原文、堆栈与评论，再定本仓范围。
- 若本仓只做衍生增强，issue 须写明**不自认为修了 upstream #N**。

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
