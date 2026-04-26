# 运行手册

使用与改动匹配的最窄验证。不要在小改动上默认运行完整测试套件。

## 环境信号

- Java 版本由 `.java-version` 控制。
- Node 版本由 `.nvmrc` 控制。
- CI 定义位于 `.github/workflows/build.yml` 和 `.github/workflows/release.yml`。

## 核心验证命令

### Java

从仓库根目录运行：

```bash
./scripts/test-java.sh
```

它会：

- 进入 `knife4j/`
- 运行 Maven `verify`

适用于：

- 修改 `knife4j/` 下任何代码
- 修改 Java 兼容性行为
- 触碰 starter 模块、UI webjar 打包或发布敏感 Java 代码

### Front Core / UI React

从仓库根目录运行：

```bash
./scripts/test-front-core.sh
```

它会：

- 进入 `knife4j-front/`（workspace 根）
- 运行 `npm ci`（统一安装所有 workspace 依赖）
- 对 `knife4j-core` workspace 运行 test、lint 和 build
- 对 `knife4j-ui-react` workspace 运行 `format:check`、`tsc` 和 `vite build`（与 CI 等价）

适用于：

- 修改解析逻辑
- 修改 `knife4j-front/knife4j-core` 下的 TypeScript 源码
- 修改 `knife4j-front/knife4j-ui-react` 下任何源码
- 修改 `knife4j-front/package.json` 或 workspace 配置

> **强制**：修改 `knife4j-front/**` 下任何源码时，必须跑 `./scripts/test-front-core.sh`。
> 不得用单步 `tsc --noEmit` / `vite build` 替代，因为 CI 还会跑 `prettier --check` 与 `eslint`，这两项本地单跑极易漏。

> **注意**：`knife4j-front/` 使用 npm workspaces。`knife4j-core` 和 `knife4j-ui-react` 共享根 `node_modules`，通过 symlink 联动。子项目不再有独立的 `package-lock.json`。

### 文档站

从仓库根目录运行：

```bash
./scripts/test-docs.sh
```

它会：

- 进入 `docs-site`
- 运行 `npm ci`
- 运行 VitePress 构建（`npm run build`）

适用于：

- 修改文档站源码
- 修改会影响站点构建的迁移指南或 release note

### 完整本地验证

从仓库根目录运行：

```bash
./scripts/test-all.sh
```

适用于：

- 改动横跨多个区域
- 准备的 PR 同时触碰 Java 和前端/文档

## 选择验证的规则

- 纯文档改动通常不需要 Java 或前端验证，除非触碰生成物或已知会影响构建的代码示例。
- 仓库流程类改动通常可以通过一致性审查验证，不需要编译。
- 对高风险 Java 改动，优先增加或更新定向测试，再做大范围修复。

## PR 后 CI 验证（强制）

`push` 或创建/更新 PR **不是**任务完成，CI 通过才是。

coordinator 或 worker 在 push 完带 `agent/` 前缀的分支或新开/更新 PR 后，必须：

1. 立即轮询或监听 PR checks，直到所有 check 达到终态：

   ```bash
   gh pr checks <N> --watch
   # 或等价的轮询：
   gh pr checks <N>
   ```

2. 任一 check 失败时：

   - 用 `gh run view <run-id> --log-failed` 定位失败片段
   - 在**同一分支**上修复（新增 commit，不 force-push 到 master）
   - 再次等待 CI 终态

3. 只有当所有 check 通过，才允许：

   - 把 issue 切到 `status:review`
   - 在 issue 评论里声称实现完成

### 对齐 CI 的本地起步脚本

为降低本地绿、CI 红的风险，优先使用 `./scripts/test-*.sh` 而不是手动拼命令：

- 前端改动→ `./scripts/test-front-core.sh`（含 `format:check`、`lint`、`test`、`build`）
- Java 改动→ `./scripts/test-java.sh`
- 文档改动→ `./scripts/test-docs.sh`
- 跨区域改动→ `./scripts/test-all.sh`

如果某个子项目（如 `knife4j-ui-react`）CI 跑的步骤本地脚本没覆盖，应该扩展脚本而不是绕过。

## PR 期望

每个 PR 或自治工作报告都应包含：

- task id
- 范围摘要
- 精确验证命令
- 验证结果
- 未解决风险

## 恢复规则

如果验证失败：

1. 记录精确失败命令
2. 在对应 issue 的评论里概括失败
3. 判断失败是否属于当前任务范围
4. 如果不属于范围，将 issue 标记为 `status:blocked`，并创建或更新后续任务

不要为了让任务看起来完成而静默降低验证标准。
