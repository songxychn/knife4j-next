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

### TASK-006
status: review
area: repo
title: 同步 CI 与 agent 文档中的主分支名为 master
branch: codex/TASK-006-sync-master-branch
depends_on: TASK-001
validation: `一致性审查：确认 workflow 与 agent 文档中的主分支引用统一为 master`
done_when:
- `.github/workflows/build.yml` 的 push 触发分支与当前主分支一致
- `AGENTS.md` 与 `.agent/` 中关于禁止直接 push 主分支的表述同步到 master
notes:
- 这是仓库配置和维护文档同步，不涉及代码构建或发布流程变更。

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
status: review
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
- Spring Boot 版本使用 ${knife4j-spring-boot.version}=2.7.18（非 4.0.1，notes 有误）
- WebFlux 变体优先级低，本任务不涉及
- 维护者已确认此为当前优先补齐的组合
- PR: https://github.com/songxychn/knife4j-next/pull/7

### TASK-004
status: done
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

### TASK-005
status: review
area: docs
title: 修正文档站"产品介绍"跳到首页的异常导航
branch: codex/TASK-005-docs-vitepress-nav
depends_on: TASK-001
validation: `cd docs-site && npm run build`
done_when:
- VitePress 站点侧边栏中的"产品介绍"不再跳转到首页
- "产品介绍"拥有与其他文档一致的独立文档页
- 顶部导航"功能"拥有独立文档页，而不是首页锚点
notes:
- 已通过受控授权创建独立任务分支，当前改动位于 `codex/TASK-005-docs-vitepress-nav`。

### TASK-007
status: review
area: java
title: 修复 /v2/api-docs 路径加分号绕过 basic 认证的安全漏洞（#886）
branch: codex/TASK-007-fix-basic-auth-bypass
depends_on:
validation: `./scripts/test-java.sh`
done_when:
- /v2/api-docs;xxx 路径无法绕过 basic 认证
- 正常路径 /v2/api-docs 认证行为不变
- 有对应的安全回归测试
notes:
- 上游 issue #886：路径加分号可绕过 Spring Security 的 basic 认证
- 修复方向：StrictHttpFirewall 或 AntPathMatcher 路径规范化
- 优先级最高，属于安全漏洞
- PR: https://github.com/songxychn/knife4j-next/pull/6

### TASK-008
status: ready
area: java
title: 兼容 Spring Boot 3.4/3.5（#874 #882 #885 #913 #960 #992）
branch: codex/TASK-008-boot34-35-compat
depends_on: TASK-003
validation: `./scripts/test-java.sh`
done_when:
- knife4j-openapi3-jakarta-spring-boot-starter 在 Boot 3.4.x 启动无报错
- knife4j-openapi3-jakarta-spring-boot-starter 在 Boot 3.5.x 启动无报错
- smoke test 覆盖两个版本
- 已知的 NoSuchMethodError / ClassNotFoundException 回归修复
notes:
- 多个 issue 反映 Boot 3.4+ 启动报错，核心是 springdoc 依赖版本未跟进
- 参考 #913 中社区提供的修复方向
- Boot 4.x 兼容性单独立任务，本任务聚焦 3.4/3.5

### TASK-009
status: review
area: java
title: 修复 gateway context-path 导致 host 缺少斜杠的 bug（#954）
branch: codex/TASK-009-fix-gateway-context-path
depends_on:
validation: `./scripts/test-java.sh`
done_when:
- 配置 context-path 后 gateway 聚合的 host 拼接正确
- 有对应的单元测试覆盖路径拼接逻辑
notes:
- 上游 issue #954：knife4j-gateway-spring-boot-starter 4.5.0 配置 context-path 后 host 少个 /
- 影响所有使用 gateway 聚合且配置了 context-path 的用户
- PR: https://github.com/songxychn/knife4j-next/pull/8

### TASK-010
status: blocked
area: ui-react
title: 推进 Vue3 前端替代 Vue2（knife4j-front 架构升级）
branch: codex/TASK-010-vue3-frontend
depends_on: TASK-004
validation: `./scripts/test-front-core.sh`
done_when:
- 明确 Vue3 迁移的范围和分阶段计划
- 至少一个核心组件完成 Vue2 → Vue3 迁移
- 迁移后功能与原版一致，无回归
notes:
- 维护者明确希望推动 Vue3 替代 Vue2
- 需要先调研 knife4j-front 现有 Vue2 组件结构，再拆分子任务
- blocked 原因：需要先完成架构调研再拆分可执行子任务，下一步由 agent 完成调研后解除
