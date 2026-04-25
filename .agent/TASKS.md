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
status: done
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
- PR: https://github.com/songxychn/knife4j-next/pull/14

### TASK-013
status: done
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
status: done
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
status: done
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
status: done
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

### TASK-017
status: done
area: ui-react
title: 真实数据对接（接 /v3/api-docs 替换 mock）
branch: codex/TASK-017-real-api-data
depends_on: TASK-015
validation: cd knife4j-front/knife4j-ui-react && npm ci && npm run build
done_when:
- 新增 api client，从 /v3/api-docs 拉取真实 OpenAPI 数据
- GroupContext 从真实接口获取 group 列表
- SidebarSearchMenu 展示真实接口列表（tags + operations）
- ApiDoc、ApiDebug、Schema 页面消费真实数据（通过 context 或 props 传入）
- 保留 mock fallback，真实接口不可用时降级展示
notes:
- 参考 knife4j-vue 的 store/globals.js 和 api/index.js 了解数据结构
- 数据入口：/v3/api-docs（OpenAPI 3）和 /v2/api-docs（Swagger 2）
- group 列表来自 /knife4j/groupSetting 或 /swagger-resources

### TASK-018
status: done
area: ui-react
title: 实现 Authorize 鉴权配置页
branch: codex/TASK-018-react-authorize
depends_on: TASK-017
validation: cd knife4j-front/knife4j-ui-react && npm ci && npm run build
done_when:
- 实现 Authorize.tsx，支持配置 Bearer token 和 Basic auth
- 鉴权信息存入 context/localStorage，ApiDebug 发请求时自动带上
notes:
- 对标 Vue2 的 views/settings/Authorize.vue
- 支持多 securityScheme（apiKey、http bearer、http basic）

### TASK-019
status: done
area: ui-react
title: 实现 GlobalParam 全局参数页
branch: codex/TASK-019-react-global-param
depends_on: TASK-017
validation: cd knife4j-front/knife4j-ui-react && npm ci && npm run build
done_when:
- 实现 GlobalParam.tsx，支持添加/删除全局请求头和 query 参数
- 全局参数存入 context，ApiDebug 发请求时自动合并
notes:
- 对标 Vue2 的 views/settings/GlobalParam.vue

### TASK-020
status: done
area: ui-react
title: 实现 Home 首页（接口统计概览）
branch: codex/TASK-020-react-home
depends_on: TASK-017
validation: cd knife4j-front/knife4j-ui-react && npm ci && npm run build
done_when:
- 实现 Home.tsx，展示当前 group 的接口统计（GET/POST/PUT/DELETE 数量）
- 展示 API 基本信息（title、version、description）
notes:
- 对标 Vue2 的 views/home/Index.vue
- 数据来自 /v3/api-docs 的 info 和 paths

### TASK-021
status: done
area: java
title: 完善 knife4j-demo 接口文档（DTO + @Schema 注解）
branch: codex/TASK-021-demo-dto
depends_on:
validation: cd knife4j && mvn -pl knife4j-demo -am -q package -DskipTests
done_when:
- UserController 的 Map<String, Object> 全部替换为具名 DTO（UserVO、UserCreateRequest、UserUpdateRequest、PageResult 等）
- 所有 DTO 字段补全 @Schema(description, example, requiredMode)
- 新增分页查询接口（GET /api/user/page，支持 pageNum/pageSize/keyword 参数）
- 新增更新接口（PUT /api/user/{id}）
- mvn package 通过
notes:
- 目标是让调试者在 Swagger UI 里能看到清晰的字段说明和示例值
- DTO 放在 com.baizhukui.knife4j.demo.dto 包下

### TASK-022
status: done
area: ui-react
title: ApiDoc 补全 requestBody 渲染
branch: codex/TASK-022-react-request-body
depends_on:
validation: cd knife4j-front/knife4j-ui-react && npm ci && npm run build
done_when:
- ApiDoc.tsx 对 POST/PUT/PATCH 接口展示 requestBody schema（字段名、类型、是否必填、描述）
- 支持 application/json 的 schema 展开（$ref 解析）
- OfficeDoc.tsx 离线导出同步补上 requestBody 内容
- npm run build 通过，无 TypeScript 错误
notes:
- 数据来自 swaggerDoc.components.schemas，需处理 $ref 引用
- 对标原版 knife4j 的接口文档展示效果

### TASK-023
status: review

area: repo
title: 构建集成——knife4j-ui-react 产物打包进 knife4j-openapi3-ui
branch: codex/TASK-023-ui-react-integration
depends_on: TASK-022
validation: cd knife4j && mvn -pl knife4j-openapi3-ui -am -q package -DskipTests && ls knife4j-openapi3-ui/target/classes/META-INF/resources/webjars/
done_when:
- knife4j-front/knife4j-ui-react 的 build 产物（dist/）复制到 knife4j-openapi3-ui/src/main/resources/webjars/
- doc.html 入口更新为指向新的 React 产物
- Maven build 通过，产物包含新前端静态资源
- 访问 /doc.html 加载的是 knife4j-ui-react 而非原 Vue2 产物
notes:
- 可通过 Maven frontend-maven-plugin 或 exec-maven-plugin 在 package 阶段自动触发 npm run build
- 或先手动 copy 验证可行性，再自动化
- 这是里程碑任务，完成后 demo 站跑新前端

### TASK-024
status: blocked
area: ui-react
title: 设置面板入口（Header 右上角整合 Authorize/GlobalParam/OfflineDoc）
branch: codex/TASK-024-settings-panel
depends_on: TASK-023
validation: cd knife4j-front/knife4j-ui-react && npm ci && npm run build
done_when:
- Header 右上角 SettingOutlined 按钮点击后弹出设置抽屉/弹窗
- 设置面板内含 Authorize、GlobalParam、OfflineDoc 三个 Tab
- npm run build 通过
notes:
- 依赖 TASK-023 完成后在真实环境验证交互
- blocked 原因：等 TASK-023 集成完成后再做，避免在沙盒里调 UI 细节

### TASK-025
status: blocked
area: ui-react
title: i18n 中英文切换
branch: codex/TASK-025-i18n
depends_on: TASK-023
validation: cd knife4j-front/knife4j-ui-react && npm ci && npm run build
done_when:
- 引入 i18n 方案（react-i18next 或类似）
- 中英文语言包覆盖所有 UI 文案
- Header 提供语言切换入口
- npm run build 通过
notes:
- 对标原版 knife4j 的 zh-CN / en-US 切换
- blocked 原因：等 TASK-023 集成后在真实环境验证

### TASK-026
status: ready
area: ui-react
title: React 调试页按 OpenAPI 参数定义渲染填参表单
branch: codex/TASK-026-react-debug-params
depends_on: TASK-013,TASK-017
validation: cd knife4j-front/knife4j-ui-react && npm run build
done_when:
- ApiDebug 根据当前 operation 展示 path、query、header、cookie 参数的待填写表单项
- 每个参数展示名称、位置、类型、required、description、default、example、enum 信息
- enum 参数使用可选项输入，boolean 参数使用布尔选择，array/object 参数有 JSON 输入兜底
- 表单初始值优先使用 example，其次 default，再按类型生成空值
- 点击发送时合并用户填写的 path/query/header/cookie 参数，不再只依赖简化输入
notes:
- 第一优先级，对标 Vue2 `knife4j-vue/src/views/api/Debug.vue` 的参数填写能力
- 交互可以更现代，但同一份 OpenAPI 下 Vue2 能展示的参数项 React 也必须展示
- 建议抽出 `operationDebugModel` 或同等工具，避免把解析逻辑堆在 ApiDebug 组件里

### TASK-027
status: blocked
area: ui-react
title: React 调试页补全 requestBody 多内容类型表单
branch: codex/TASK-027-react-debug-request-body
depends_on: TASK-026
validation: cd knife4j-front/knife4j-ui-react && npm run build
done_when:
- application/json 根据 schema 生成可编辑 JSON 示例
- application/x-www-form-urlencoded 根据 schema properties 展示字段表单
- multipart/form-data 支持普通字段和 file/binary 文件字段
- raw/text/xml 等未知内容类型提供可编辑文本输入兜底
- 发送请求时按所选 content-type 正确构造 body 和 Content-Type
notes:
- 对标 Vue2 `initBodyParameter`、`debugSendFormRequest`、`debugSendRawRequest` 等调试链路
- 依赖 TASK-026 的参数模型，避免 requestBody 和普通参数各自实现一套解析

### TASK-028
status: blocked
area: ui-react
title: React 调试发送前校验与请求预览
branch: codex/TASK-028-react-debug-request-builder
depends_on: TASK-027
validation: cd knife4j-front/knife4j-ui-react && npm run build
done_when:
- 发送前校验 required 的 path/query/header/cookie/body 字段，缺失时定位到对应输入项
- 调试页展示最终请求 URL、method、headers、query、body 预览
- 支持复制等价 curl 命令
- path 参数替换、query 拼接、header 合并、body 序列化由统一 requestBuilder 负责
notes:
- 对标 Vue2 `Knife4jDebugger.js` 和 Debug.vue 的请求组装职责
- 需要保留同源 Spring Boot starter 场景优先，不在本任务扩展跨域代理能力

### TASK-029
status: blocked
area: ui-react
title: React 调试响应面板对齐 Vue2 能力
branch: codex/TASK-029-react-debug-response-panel
depends_on: TASK-028
validation: cd knife4j-front/knife4j-ui-react && npm run build
done_when:
- 响应区展示 status、耗时、headers、body、错误信息
- JSON 响应自动格式化并支持复制原始内容
- 非 JSON 响应用文本兜底，二进制响应给出下载或不可预览提示
- 保留最近一次请求和响应，切换文档/调试 Tab 不丢失当前填写内容
notes:
- 对标 Vue2 `knife4j-vue/src/views/api/DebugResponse.vue`
- 本任务只做单接口内状态保持，跨接口历史记录可后续拆分

### TASK-030
status: blocked
area: ui-react
title: React schema 示例生成对齐 Vue2 递归展开
branch: codex/TASK-030-react-schema-example-builder
depends_on: TASK-027
validation: cd knife4j-front/knife4j-ui-react && npm run build
done_when:
- 根据 schema 递归生成 JSON 示例，支持 $ref、object、array、enum、example、default
- 循环引用不会造成死循环，重复引用类型以安全占位值截断
- requestBody JSON 示例、ApiDoc 示例和 Models 示例复用同一生成逻辑
- 对深层嵌套有显式 maxDepth 保护，并在代码中集中配置
notes:
- 对标 Vue2 `Knife4jAsync.js` 的 `findRefDefinition` 与 utils 示例值逻辑
- Vue2 不是固定深度展开，而是递归展开并通过引用链数组防循环；React 版建议增加 maxDepth 保险

### TASK-031
status: blocked
area: ui-react
title: React 调试接入鉴权与全局参数
branch: codex/TASK-031-react-debug-auth-global-param
depends_on: TASK-028,TASK-018,TASK-019
validation: cd knife4j-front/knife4j-ui-react && npm run build
done_when:
- ApiDebug 发送请求时自动合并 Authorize 中配置的认证信息
- ApiDebug 发送请求时自动合并 GlobalParam 中配置的 header/query 参数
- 接口级参数与全局参数冲突时有明确优先级，并在 UI 中可见
- 用户可以在发送前预览最终合并后的 headers/query
notes:
- 对标 Vue2 全局参数、Authorize 与 Debug.vue 的联动能力
- 依赖请求预览和 requestBuilder 稳定后再接入，避免参数来源混乱
