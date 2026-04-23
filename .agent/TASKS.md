# 任务队列

使用以下状态：

- `ready`：范围清晰，可由 agent 自治执行
- `blocked`：缺少决策、环境或外部依赖
- `in_progress`：已有分支正在处理
- `review`：已实现，等待人工审查或合并
- `done`：已合并或以其他方式完成

每个任务都应足够小，能在一个分支和一次审查周期内完成。

## 模板

```md
### TASK-000
status: ready
area: java | docs | front-core | ui-react | repo
title: 简短、可执行的标题
branch: codex/TASK-000-short-slug
depends_on:
validation: <一个命令，或一组简短命令>
done_when:
- 可观察完成条件 1
- 可观察完成条件 2
notes:
- 约束、假设或链接
```

## 队列

### TASK-001
status: done
area: repo
title: 增加 fork 专属的贡献流程和自治维护文档
branch: codex/TASK-001-agent-docs
depends_on:
validation: `纯 Markdown 变更，无需代码构建`
done_when:
- 根目录存在面向人类和 agent 的维护说明
- `.agent/` 状态文件反映当前项目意图和安全边界
notes:
- 这个任务用于给自治运行提供持久起点。

### TASK-002
status: ready
area: docs
title: 审计 README 和文档中的旧 upstream 归属表述
branch: codex/TASK-002-doc-ownership-audit
depends_on: TASK-001
validation: `cd knife4j-doc && npm ci && npm run build-netlify`
done_when:
- fork 自己的入口和迁移表述更清楚
- 保留的 upstream 引用都是有意且有解释的
notes:
- 保留历史署名和感谢，只修复容易造成归属误解的表述。

### TASK-003
status: ready
area: java
title: 新增 boot3-app smoke 模块（knife4j-openapi3-spring-boot-starter）
branch: codex/TASK-003-java-smoke-coverage
depends_on:
validation: `./scripts/test-java.sh`
done_when:
- knife4j-smoke-tests 下新增 boot3-app 子模块
- 使用 knife4j-openapi3-spring-boot-starter（非 jakarta）
- smoke test 验证 /doc.html 和 /v3/api-docs 返回 200
- mvn verify 在该模块通过
notes:
- 参考现有 boot3-jakarta-app 的结构，只换 starter 依赖
- Spring Boot 版本与 boot3-jakarta-app 保持一致（4.0.1）
- WebFlux 变体优先级低，本任务不涉及
- 维护者已确认此为当前优先补齐的组合

### TASK-004
status: review
area: front-core
title: 审计 parser-core 测试和 lint 覆盖缺口
branch: codex/TASK-004-front-core-audit
depends_on:
validation:
- `./scripts/test-front-core.sh`
done_when:
- 一个窄范围覆盖缺口被转化为可执行修复或后续任务
- 结果写回 `.agent/PROGRESS.md`
notes:
- 保持为一个小修复或一个具体审计结果，不要变成重写。
- 分支已推送，PR 待人工通过 gh auth login 后创建，或直接在 GitHub 上开 PR。
- PR compare URL: https://github.com/songxychn/knife4j-next/compare/codex/TASK-004-front-core-audit
