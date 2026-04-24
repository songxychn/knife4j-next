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
status: done
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
status: done
area: docs
title: 审计 README 和文档中的旧 upstream 归属表述
branch: codex/TASK-002-doc-ownership-audit
depends_on: TASK-001
validation: `cd docs-site && npm ci && npm run build`
done_when:
- fork 自己的入口和迁移表述更清楚
- 保留的 upstream 引用都是有意且有解释的
notes:
- 保留历史署名和感谢，只修复容易造成归属误解的表述。
- PR: https://github.com/songxychn/knife4j-next/pull/11

### TASK-003
status: done
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
status: done
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
status: done
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
status: done
area: java
title: 兼容 Spring Boot 3.4/3.5（#874 #882 #885 #913 #960 #992）
branch: codex/TASK-008-boot34-35-compat
depends_on:
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
status: done
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
status: done
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

### TASK-011
status: done
title: 新增 knife4j-demo 模块，提供在线预览站
branch: codex/TASK-011-demo-site
depends_on: TASK-008
goal: |
  在 knife4j/ 下新增 knife4j-demo 子模块，包含：
  - 最小 Spring Boot 应用 + 示例 Controller
  - Dockerfile
  - GitHub Actions workflow（tag 触发，构建推送 GHCR）
  - docker-compose.yml（供服务器部署用）
  - Caddyfile 片段
validation: mvn -pl knife4j/knife4j-demo package -DskipTests

### TASK-012
status: review
area: ui-react
title: 实现 ApiDoc 接口文档展示页（参数表格 + 响应结构）
branch: codex/TASK-012-react-api-doc
depends_on:
validation: cd knife4j-front/knife4j-ui-react && npm ci && npm run build
done_when:
- ApiDoc.tsx 展示接口的请求参数表格（名称、类型、是否必填、描述）
- 展示响应结构（状态码、schema）
- 数据来自 knife4j-core 解析结果（mock 数据驱动开发即可）
notes:
- 对标 Vue2 的 views/api/Document.vue
- 不需要实际发请求，只做展示

### TASK-013
status: ready
area: ui-react
title: 实现 ApiDebug 接口调试功能（表单填参 + 发请求 + 展示响应）
branch: codex/TASK-013-react-api-debug
depends_on: TASK-012
validation: cd knife4j-front/knife4j-ui-react && npm ci && npm run build
done_when:
- ApiDebug.tsx 支持填写请求参数（query/header/body）
- 点击发送后调用实际接口并展示响应（状态码、耗时、响应体）
- 支持 JSON body 编辑
notes:
- 对标 Vue2 的 views/api/Debug.vue + DebugResponse.vue
- 这是最核心的功能，优先级最高

### TASK-014
status: review
area: ui-react
title: 实现侧边栏多 group 切换与接口搜索
branch: codex/TASK-014-react-sidebar-search
depends_on:
validation: cd knife4j-front/knife4j-ui-react && npm ci && npm run build
done_when:
- 顶部或侧边栏支持多 group（多个 swagger 文档源）切换
- 侧边栏支持按接口名/路径搜索过滤
notes:
- 对标 Vue2 的 components/SiderMenu/ + components/HeaderSearch/
- ResizableMenu.tsx 已存在，在此基础上扩展

### TASK-015
status: ready
area: ui-react
title: 实现 SwaggerModels 数据模型展示页
branch: codex/TASK-015-react-swagger-models
depends_on: TASK-012
validation: cd knife4j-front/knife4j-ui-react && npm ci && npm run build
done_when:
- 新增 Models 页面，展示所有 schema 定义
- 支持展开/折叠每个 model 的字段
notes:
- 对标 Vue2 的 views/settings/SwaggerModels.vue
- 数据来自 /v3/api-docs 的 components.schemas

### TASK-016
status: blocked
area: ui-react
title: 离线文档导出（Word/HTML）
branch: codex/TASK-016-react-offline-doc
depends_on: TASK-012,TASK-013
validation: cd knife4j-front/knife4j-ui-react && npm ci && npm run build
done_when:
- 支持导出当前接口文档为 HTML 或 Word 格式
notes:
- 对标 Vue2 的 views/settings/OfficelineDocument.vue + officeDocument/ 工具集
- blocked：依赖 TASK-012/013 完成后再评估是否复用 Vue2 的 wordTransform 逻辑
