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

### Front Core

从仓库根目录运行：

```bash
./scripts/test-front-core.sh
```

它会：

- 进入 `knife4j-front/`（workspace 根）
- 运行 `npm ci`（统一安装所有 workspace 依赖）
- 对 `knife4j-core` workspace 运行 test、lint 和 build

适用于：

- 修改解析逻辑
- 修改 `knife4j-front/knife4j-core` 下的 TypeScript 源码
- 修改 `knife4j-front/package.json` 或 workspace 配置

> **注意**：`knife4j-front/` 使用 npm workspaces。`knife4j-core` 和 `knife4j-ui-react` 共享根 `node_modules`，通过 symlink 联动。子项目不再有独立的 `package-lock.json`。

### 文档站

从仓库根目录运行：

```bash
./scripts/test-docs.sh
```

它会：

- 进入 `knife4j-doc`
- 运行 `npm ci`
- 运行文档构建

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
2. 在 `.agent/PROGRESS.md` 概括失败
3. 判断失败是否属于当前任务范围
4. 如果不属于范围，将任务标记为 `blocked`，并创建或更新后续任务

不要为了让任务看起来完成而静默降低验证标准。
