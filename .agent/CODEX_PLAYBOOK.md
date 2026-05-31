# Codex 现场协作手册

本手册用于维护者在电脑前使用 Codex 推进任务的场景。它补充
`.agent/SERVER_PLAYBOOK.md`，不是替代安全边界和发布纪律。

## 适用场景

- 维护者明确在当前会话中要求 Codex 处理一个任务。
- 维护者已经在场，可以及时确认产品方向、发布动作或高风险取舍。
- 任务仍然通过 GitHub Issues + Labels 留存状态；短小流程维护任务可以在 PR
  描述中说明没有对应 issue。

无人值守或定时唤醒仍使用 `.agent/SERVER_PLAYBOOK.md`。

## 快速入口

先查看当前工作区和任务队列：

```bash
./scripts/agent-status.sh snapshot
```

如果只想看任务看板：

```bash
./scripts/agent-status.sh
```

## 现场协作循环

1. 读取 `AGENTS.md` 指定的 `.agent/` 文件，确认项目边界。
2. 确认任务来源：
   - 维护者直接指定的任务；或
   - `agent-task` + `status:ready` 的 GitHub Issue。
3. 对任务做可执行性检查，缺失信息时先补 issue 或向维护者确认。
4. 创建或切换任务分支：
   - 有 issue：`agent/<task-id>-<short-slug>`。
   - 无 issue 的现场流程维护：`agent/codex-<short-slug>`。
5. 做满足任务的最小改动，不夹带无关清理。
6. 运行 `.agent/RUNBOOK.md` 中最窄相关验证。
7. 创建或更新 PR，并等待 PR CI 终态。
8. 只有本地验证、必要审查和 PR CI 都通过后，才把 issue 切到
   `status:review`。

## 任务可执行性检查

每个准备进入实现的任务至少应明确：

- 目标文件或模块。
- 预期行为变化。
- 验证命令。
- 完成条件。
- 风险等级和是否需要人工决策。

Upstream issue 相关任务还必须明确：

- 已通读 upstream 原文、堆栈、截图和评论。
- 本仓库是否复现同一问题。
- 如果本仓库任务只是衍生范围，issue 正文必须明说不自认为修复 upstream。

缺少这些信息时，先补 issue 评论或把任务保持在 `status:blocked`，不要凭猜测写
防御性代码。

## 风险分级门禁

### 低风险元数据

包括 label、issue、PR 文案、纯流程文档、模板小修和不改变运行时行为的错别字修订。

- Codex 可以直接处理。
- 可以跳过 worker 和 reviewer。
- 如果创建 PR，在 PR 描述里写明跳过原因和替代验证。

### 普通低风险实现

包括单模块前端修复、测试补强、文档站改动、局部脚本改进，并且行为变化清晰、验证
命令明确、回滚简单。

- Codex 可以直接实现。
- 如果没有独立 agent，允许跳过 worker，但要记录原因。
- reviewer 可由维护者人工 review 替代；进入 `status:review` 前必须有 PR CI 与
  reviewer/人工审查结论，或在 PR 中记录明确跳过理由。

### 高风险实现

满足任一条件即视为高风险：

- 修改 Java 兼容性行为。
- 触碰多个模块。
- 修改构建脚本、CI workflow 或发布相关逻辑。
- 验证曾失败，后来才通过。
- coordinator 对 diff 的回归风险没有足够把握。

要求：

- 优先使用独立 worker/reviewer，或明确等待维护者人工 review。
- reviewer 结论必须先用真实 `git diff` / `git show` 核对。
- 不得在缺少审查结论时把 issue 切到 `status:review`。

### 必须人工确认

以下事项仍然必须停下来问维护者：

- 发布构件或推送 release tag。
- 修改 release 逻辑或凭据接线。
- 修改项目坐标或兼容性承诺。
- 删除模块、大目录或重要历史代码。
- 大范围依赖升级。
- 含糊的产品方向决策。

## Issue 评论纪律

现场使用 Codex 时，不需要把每个中间想法都写进 issue。只在这些节点写回：

- 接手任务或发现任务不可执行。
- 发现 blocker。
- 完成实现和本地验证。
- 创建或更新 PR。
- PR CI 结果。
- reviewer 或人工审查结论。

评论应包含命令、结果和下一步，不粘贴长日志。

## PR 描述纪律

PR 描述至少包含：

- 关联 issue 或说明无 issue 的原因。
- 变更范围。
- 验证命令和结果。
- worker/reviewer handoff，或跳过原因。
- 已知风险和范围外事项。

PR 创建或更新后必须等待：

```bash
gh pr checks <N> --watch
```

CI 未到终态时，不要声称任务完成。

## 发布任务

发布流程不因为维护者在场而简化。发布构件前必须获得维护者明确确认，完成状态仍以
`.agent/RUNBOOK.md` 的正式发布验收为准：

- `vX.Y.Z` tag 已推送。
- `Release` workflow 成功。
- `Build and Deploy Demo` workflow 成功。
- Maven Central 目标构件可访问。
- GitHub Release `vX.Y.Z` 存在。
- GitHub Release body 与 `docs-site/release-notes/index.md` 对应版本小节一致。

## 停止条件

出现以下任一情况时，Codex 应停在清晰检查点：

- 任务完成并且 PR/验证状态已写清。
- 需要维护者做产品或发布决策。
- blocker 连续出现，继续尝试只会扩大范围。
- 工作区出现非本任务引入的冲突或异常改动。
- 验证失败超出当前任务范围。
