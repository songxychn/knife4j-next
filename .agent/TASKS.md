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
status: review
area: ui-react
title: React 调试页按 OpenAPI 参数定义渲染填参表单
branch: codex/TASK-026-react-debug-params
depends_on: TASK-032
validation: cd knife4j-front/knife4j-ui-react && npm run build
done_when:
- ApiDebug 根据当前 operation 展示 path、query、header、cookie 参数的待填写表单项
- 每个参数展示名称、位置、类型、required、description、default、example、enum 信息
- enum 参数使用可选项输入，boolean 参数使用布尔选择，array/object 参数有 JSON 输入兜底
- 表单初始值优先使用 example，其次 default，再按类型生成空值
- 点击发送时合并用户填写的 path/query/header/cookie 参数，不再只依赖简化输入
notes:
- 阶段 1 第 1 步，对标 Vue2 `knife4j-vue/src/views/api/Debug.vue` 的参数填写能力
- 交互可以更现代，但同一份 OpenAPI 下 Vue2 能展示的参数项 React 也必须展示
- 消费 TASK-032 抽出的 `OperationDebugModel`，禁止把解析逻辑堆回 ApiDebug 组件
- deprecated / readOnly 参数在 UI 中用独立样式标记，但不阻止用户填写
- blocked 原因：等 TASK-032 的参数解析 API 稳定后再落实现

### TASK-027
status: blocked
area: ui-react
title: React 调试页补全 requestBody 多内容类型表单
branch: codex/TASK-027-react-debug-request-body
depends_on: TASK-026
validation: cd knife4j-front/knife4j-ui-react && npm run build
done_when:
- application/json 根据 schema 生成可编辑 JSON 示例（复用 TASK-030 的 schemaExampleBuilder）
- application/x-www-form-urlencoded 根据 schema properties 展示字段表单
- multipart/form-data 支持普通字段和 file/binary 文件字段，并支持文件拖拽上传
- raw 支持 Text / JSON / JavaScript / XML / HTML 模式切换，提供 Beautify 入口
- 发送请求时按所选 content-type 正确构造 body 和 Content-Type，由统一 requestBuilder 负责
notes:
- 阶段 1 第 2 步，对标 Vue2 `initBodyParameter`、`debugSendFormRequest`、`debugSendRawRequest`
- requestBody 必须共用 TASK-032 的参数模型，禁止 body 和普通参数各写一套解析
- 当同一 operation 同时定义多种 content-type 时，UI 以单选 Radio 暴露，默认选 application/json

### TASK-028
status: blocked
area: ui-react
title: React 调试发送前校验与请求预览
branch: codex/TASK-028-react-debug-request-builder
depends_on: TASK-027
validation: cd knife4j-front/knife4j-ui-react && npm run build
done_when:
- 发送前校验 required 的 path/query/header/cookie/body 字段，缺失时定位到对应输入项并阻止发送
- 调试页展示最终请求 URL、method、headers、query、body 预览（独立 Tab 或抽屉）
- 支持复制等价 curl 命令，curl 与真实发送共用同一 requestBuilder 输出
- path 参数替换、query 拼接、header 合并、body 序列化由统一 requestBuilder 负责，输出纯对象 `{ url, method, headers, body, contentType }`
- requestBuilder 单独放在 TASK-032 抽出的 knife4j-core 下，含独立单元测试
notes:
- 阶段 1 第 3 步，对标 Vue2 `Knife4jDebugger.js` 和 Debug.vue 的请求组装职责
- 保留同源 Spring Boot starter 场景优先，不在本任务扩展跨域代理能力
- 请求发送仍用原生 fetch，不引入 axios；blob 处理在 TASK-029 单独考虑

### TASK-029
status: blocked
area: ui-react
title: React 调试响应面板对齐 Vue2 能力
branch: codex/TASK-029-react-debug-response-panel
depends_on: TASK-028
validation: cd knife4j-front/knife4j-ui-react && npm run build
done_when:
- 响应区展示 status、耗时、响应体大小、headers、body、错误信息
- 响应 Tab 划分为 Content / Raw / Headers / Curl 四个子 Tab
- JSON 响应自动格式化并支持复制原始内容（Raw Tab）
- 非 JSON 响应用文本兜底；二进制响应按 Content-Type 判断：图片预览，其他给下载链接
- 保留最近一次请求和响应，切换文档/调试 Tab 不丢失当前填写内容
notes:
- 阶段 1 第 4 步，对标 Vue2 `knife4j-vue/src/views/api/DebugResponse.vue`
- 本任务只做单接口内状态保持，跨接口历史记录可后续拆分
- Vue2 的「响应字段描述叠加到 JSON 编辑器」能力本任务明确不做，留到后续独立任务评估
- Vue2 的 Base64Img Tab 若实现成本低可一并做，否则延后

### TASK-030
status: blocked
area: front-core
title: schema 示例生成与字段树递归（knife4j-core）
branch: codex/TASK-030-schema-example-builder
depends_on: TASK-032
validation:
- ./scripts/test-front-core.sh
- cd knife4j-front/knife4j-ui-react && npm run build
done_when:
- 在 knife4j-core 中完成 TASK-032 预留的 `buildSchemaExample(schema, ctx)` 与 `buildSchemaFieldTree(schema, ctx)` 实现
- 支持 $ref、object、array、enum、example、default、allOf、oneOf、anyOf（后三者取第一个可解析分支）
- 循环引用通过引用链数组截断，重复引用以类型占位值兜底，不会死循环
- 有显式 maxDepth 保护（默认 8），集中配置，超过深度截断并附 `__truncated__` 标记
- React 的 requestBody JSON 示例、ApiDoc 请求体/响应体字段树、Schema 页全部复用同一生成逻辑
- knife4j-core 侧新增不少于 10 个单元测试覆盖上述分支
notes:
- 阶段 1 第 5 步，area 由 ui-react 改为 front-core：逻辑放在 knife4j-core 供 React/Vue3/未来 Vue2 共用
- 对标 Vue2 `Knife4jAsync.js` 的 `findRefDefinition` + `OAS3SchemaPropertyReader.js`
- OAS2 的 `definitions` 与 OAS3 的 `components.schemas` 统一抽象成同一个 resolver，调用方不感知规范差异

### TASK-031
status: blocked
area: ui-react
title: React 调试接入鉴权与全局参数
branch: codex/TASK-031-react-debug-auth-global-param
depends_on: TASK-028,TASK-018,TASK-019
validation: cd knife4j-front/knife4j-ui-react && npm run build
done_when:
- ApiDebug 发送请求时自动合并 Authorize 中配置的认证信息（当前阶段仅覆盖已实现的 bearer/basic；securityScheme 动态渲染留到 TASK-033）
- ApiDebug 发送请求时自动合并 GlobalParam 中配置的 header/query 参数
- 接口级参数与全局参数冲突时按「接口级 > 全局」优先级合并，并在请求预览 Tab 中以来源标签展示
- 用户可以在发送前预览最终合并后的 headers/query/body
- 合并逻辑由 requestBuilder 承担，调试组件只负责 UI 与数据源
notes:
- 阶段 1 第 6 步，对标 Vue2 全局参数、Authorize 与 Debug.vue 的联动能力
- 依赖请求预览和 requestBuilder 稳定后再接入，避免参数来源混乱
- 本任务不包含 OAuth2 / securityScheme 动态表单（阶段 3 独立任务 TASK-033 处理）
- 接入顺序：requestBuilder 合并层 → GlobalParam → Authorize（bearer/basic），每一步保留 UI 预览可验证

### TASK-032
status: review
area: front-core
title: 抽取调试/解析层到 knife4j-core（阶段 1 前置）
branch: codex/TASK-032-core-debug-model
depends_on:
validation:
- ./scripts/test-front-core.sh
- cd knife4j-front/knife4j-ui-react && npm run build
done_when:
- knife4j-core 中新增以下公共模块（保持为纯 TS，无框架依赖）：
  - `resolveRef(ref, doc)`：统一处理 OAS2 `definitions` 与 OAS3 `components.schemas`
  - `OperationDebugModel`：从一个 operation 解析出 `{ pathParams, queryParams, headerParams, cookieParams, bodyContents[] }`，每个参数带 `name / in / type / required / description / default / example / enum / deprecated / readOnly / schema`
  - `BodyContent`：按 content-type 分类（json / urlencoded / multipart / raw）并附带初始示例生成入口
  - `buildSchemaExample` / `buildSchemaFieldTree` 先落接口与签名，实际实现放到 TASK-030
  - `requestBuilder`：输入 operation + 用户填写 + 全局参数 + 鉴权，输出纯 `{ url, method, headers, query, body, contentType }`；同时输出等价 curl 字符串
- 上述模块有独立单元测试，覆盖：path 参数替换、query/header 合并、required 校验失败、curl 字符串转义
- knife4j-ui-react 通过本地依赖（`file:../knife4j-core` 或 tgz 再打一版）消费这些模块，当前页面行为不变
- ./scripts/test-front-core.sh 通过
- knife4j-ui-react `npm run build` 通过
notes:
- 这是阶段 1 的前置任务，后续 TASK-026 ~ TASK-031 全部依赖它
- 只抽象 + 适配，不改 UI 行为；UI 的实际能力提升放到 TASK-026 及之后
- 解析层必须同时兼容 OAS2 (`parameters[].in=body` / formData / type+format) 与 OAS3 (`requestBody` / `schema`)
- requestBuilder 本任务只落「纯函数 + 测试」，不做 UI 预览；UI 预览在 TASK-028 使用它
- 禁止在 knife4j-core 引入 React / Vue / antd 等框架依赖
- 禁止在 knife4j-core 直接依赖浏览器 API（fetch/localStorage）；发送和持久化留给 UI 层
- 可选：若现有 knife4j-core 版本号需要升，保持 semver 兼容，不清理无关导出

### TASK-033
status: blocked
area: ui-react
title: Authorize 按 OpenAPI securitySchemes 动态渲染并接入请求
branch: codex/TASK-033-authorize-security-schemes
depends_on: TASK-031
validation: cd knife4j-front/knife4j-ui-react && npm run build
done_when:
- Authorize 页根据当前 OpenAPI 的 `securitySchemes` 动态渲染表单（apiKey / http bearer / http basic）
- 一个文档定义多个 security key 时，全部可填、分别保存
- 配置按 groupId 持久化到 IndexedDB（使用 idb-keyval），兼容刷新和多分组切换
- OAuth2 支持 password 与 client_credentials 两种 flow；authorization_code 留作可选后续任务；implicit 明确不实现
- ApiDebug 发送请求时按 operation 的 `security` 字段选择对应的 scheme 并注入 header / query
notes:
- 阶段 3 对齐任务，对标 Vue2 `knife4j-vue/src/views/settings/Authorize.vue` + `OAuth2.vue`
- implicit flow 明确不做，理由：现代浏览器不推荐、redirect 回跳对 starter 场景不友好；文档注明
- authorization_code flow 本任务不做；如后续要做单独立 TASK
- 本任务仅扩展 TASK-031 的鉴权合并层，不重写 requestBuilder

### TASK-034
status: review
area: repo
title: knife4j-front 引入 npm workspaces 替代本地 tgz 依赖
branch: codex/TASK-034-knife4j-front-workspaces
depends_on: TASK-032
validation:
- ./scripts/test-front-core.sh
- cd knife4j-front/knife4j-ui-react && npm run build
done_when:
- `knife4j-front/` 新增根 `package.json`，声明 `workspaces: ["knife4j-core", "knife4j-ui-react"]`，`private: true`
- `knife4j-ui-react/package.json` 中 `"knife4j-core": "file:knife4j-core-1.0.0.tgz"` 改为 workspace 指向（如 `"*"`）
- 删除 `knife4j-front/knife4j-core/knife4j-core-1.0.0.tgz` 与 `knife4j-front/knife4j-ui-react/knife4j-core-1.0.0.tgz`
- 删除子项目各自的 `package-lock.json`（由根 lockfile 接管）
- 在 `knife4j-front/` 根目录运行 `npm install` 成功，生成统一的 `node_modules` 与 `package-lock.json`
- `scripts/test-front-core.sh` 改为先在 `knife4j-front/` 根目录 `npm ci`，再对 `knife4j-core` 运行 test / lint / build
- `.agent/RUNBOOK.md` 的「Front Core」章节同步新命令
- `knife4j-ui/`（ant-design-pro，用 pnpm）**不**纳入本次 workspace，避免 lockfile 冲突
notes:
- 目的：去掉手工 `npm pack` + 覆盖 tgz + 删 `package-lock.json` 的开发链路
- 对照 Maven 父子 POM：根 `package.json` 类比父 POM 的 `<modules>`，子 `package.json` 类比子模块 POM
- 不引入 pnpm / yarn / turborepo，坚持纯 npm workspaces，减少工具链变化面
- 本任务不触碰 `knife4j-front/knife4j-cli`、`knife4j-front/knife4j-extension*`（均只含 README）
- 不修改发布流程、Maven webjar 聚合、Java 端代码
- 回滚路径：还原 `knife4j-front/package.json`、两份 tgz、两份 lockfile、`scripts/test-front-core.sh`

### TASK-035
status: review
area: repo
title: 升级 Node 20 → 22 LTS 并修复 TASK-034 遗留的 CI workspace 路径
branch: codex/TASK-035-node22-upgrade
depends_on: TASK-034
validation:
- ./scripts/test-front-core.sh
- cd knife4j-front && npm run build -w knife4j-ui-react
- ./scripts/test-docs.sh
- cd docs-site && npm ci && npm run build
done_when:
- `.nvmrc` 从 `20` 改为 `22`
- `.github/workflows/build.yml` 中 `node-version: "20"` 统一为 `node-version-file: .nvmrc`
- `.github/workflows/build.yml` 修正 `cache-dependency-path`：
  - `java-build-test` job 的 `knife4j-front/knife4j-ui-react/package-lock.json` → `knife4j-front/package-lock.json`
  - 安装步骤 `working-directory: knife4j-front/knife4j-ui-react` → `knife4j-front`（workspace root）
  - `front-core-test` job 的 `knife4j-front/knife4j-core/package-lock.json` → `knife4j-front/package-lock.json`
- `knife4j-front/package.json` 添加 `"engines": { "node": ">=22" }`
- 本地 Node 22 下 `./scripts/test-front-core.sh` 通过
- 本地 Node 22 下 `npm run build -w knife4j-ui-react` 通过
- 本地 Node 22 下 `./scripts/test-docs.sh` 通过（knife4j-doc Docusaurus）
- 本地 Node 22 下 `docs-site` 构建通过（VitePress）
- `package-lock.json` 若因 npm patch 差异小幅变化是可接受的；不得因 Node 升级产生大面积 peer 冲突
notes:
- 目的：对齐 Node Active LTS 22（20 预计 2026-10 EOL），统一 CI 两种写法为 `.nvmrc` 单真相源，顺手修掉 TASK-034 遗留的 CI 路径破损
- 不引入 Node 22 新特性到业务代码（如内建 test runner、watch mode）；保持现有 jest/vite 工具链
- 不动 `knife4j-ui/`（pnpm）和 `knife4j-vue/`（Vue2 历史代码）的 engines，避免无关改动
- 回滚路径：`.nvmrc` 回 20、CI workflow 还原两处、删除 `knife4j-front/package.json` 的 engines 字段
