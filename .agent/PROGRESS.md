# 进度日志

新记录追加在底部。

## 模板

```md
## YYYY-MM-DD HH:MM TZ
task: TASK-000
agent: <名称>
branch: <分支名>
status: in_progress | blocked | review | done
summary:
- 简短事实
- 简短事实
validation:
- 命令和结果
next:
- 下一步
blockers:
- blocker，如无则写 none
```

## 2026-04-23 19:27 UTC
task: TASK-003
agent: knife4j-next-bot
branch: codex/TASK-003-java-smoke-coverage
status: review
summary:
- 新增 knife4j-smoke-tests/boot3-app 子模块
- 使用 knife4j-openapi3-spring-boot-starter（Boot 2.x + OpenAPI 3，非 jakarta）
- Spring Boot 版本 2.7.18（TASK notes 中 4.0.1 有误，已修正）
- Boot3DocHttpSmokeTest 验证 /doc.html 和 /v3/api-docs 返回 200
- 注册到 knife4j-smoke-tests/pom.xml modules
validation:
- `JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 mvn -B -ntp -Dknife4j-skipTests=false verify` → BUILD SUCCESS（全部 17 模块）
next:
- 等待人工 review PR #7
- PR 合并后可推进 TASK-008（Boot 3.4/3.5 兼容性）
blockers:
- 无
pr: https://github.com/songxychn/knife4j-next/pull/7

## 2026-04-24 08:25 UTC
task: TASK-002
agent: knife4j-next-bot
branch: codex/TASK-002-doc-ownership-audit
status: review
summary:
- 审计所有 docs-site 和 README 的归属表述，整体清晰无误导
- 修复 README 文档站命令和链接（knife4j-doc 已废弃 → docs-site）
- 修复 README 模块表格，补充 docs-site 行，knife4j-doc 标注已废弃
- 移除 compatibility.md 本地绝对路径泄露
- 修正 getting-started.md VitePress dev 端口 4173 → 5173
validation:
- cd docs-site && npm ci && npm run build → build complete in 5.73s ✓
next:
- 等待人工 review PR #11
blockers:
- 无
pr: https://github.com/songxychn/knife4j-next/pull/11

## 2026-04-23 21:58 UTC
task: TASK-009
agent: knife4j-next-bot
branch: codex/TASK-009-fix-gateway-context-path
status: review
summary:
- PathUtils.processContextPath 加前导斜杠保护，防止 host 拼接缺少 /
- OpenAPIEndpoint.configUrl 改为 PathUtils.append(basePath, "/v3/api-docs/swagger-config")
- 新增 PathUtilsTest.test_processContextPath_leadingSlash 回归测试
validation:
- JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 mvn -B -ntp -Dknife4j-skipTests=false verify → BUILD SUCCESS（16 模块）
next:
- 等待人工 review PR #8
blockers:
- 无
pr: https://github.com/songxychn/knife4j-next/pull/8

## 2026-04-23 19:27 UTC
task: TASK-007
agent: knife4j-next-bot subagent
branch: codex/TASK-007-fix-basic-auth-bypass
status: review
summary:
- 定位漏洞根源：BasicFilter.match() 和 AbstractBasicAuthFilter.match() 未剥离 URI 中的分号路径参数
- 修复 knife4j-core/BasicFilter.java：在正则匹配前截断分号后缀
- 修复 knife4j-gateway-spring-boot-starter/AbstractBasicAuthFilter.java：同上
- 新增安全回归测试 BasicFilterSemicolonBypassTest（11 个用例，全部通过）
- 修复 scripts/test-java.sh：自动检测 JAVA_HOME，解决 CI 环境 javadoc 插件报错
validation:
- `bash scripts/test-java.sh` → BUILD SUCCESS（全部 16 模块）
- 11 个新安全测试 + 2 个已有测试全部通过
next:
- 等待人工 review PR #6
blockers:
- 无
pr: https://github.com/songxychn/knife4j-next/pull/6

## 2026-04-24 00:10 CST
task: TASK-006
agent: codex
branch: codex/TASK-006-sync-master-branch
status: review
summary:
- 根据维护者说明，仓库远端默认分支已切换为 `master`，现有 `build.yml` 中监听 `main` 的 push 触发已过时。
- 已将 `.github/workflows/build.yml` 的 `push.branches` 从 `main` 改为 `master`。
- 已同步更新 `AGENTS.md`、`.agent/AUTONOMY_POLICY.md` 和 `.agent/prompts/openclaw-orchestrator.md` 中关于禁止直接 push 主分支的表述。
validation:
- `rg -n "main|master" .github/workflows AGENTS.md .agent -g '!**/.git/**'` 已确认目标文件中的主分支引用统一为 `master`
- `git diff -- .github/workflows/build.yml AGENTS.md .agent/AUTONOMY_POLICY.md .agent/prompts/openclaw-orchestrator.md` 已确认改动范围仅限预期文件
next:
- 提交、推送并创建 PR
blockers:
- none

## 2026-04-23 00:00 CST
task: TASK-001
agent: codex
branch: codex/TASK-001-agent-docs
status: review
summary:
- 新增 `AGENTS.md` 和初始 `.agent/` 运行文件，用于自治维护。
- 记录了项目意图、任务格式、验证 runbook、审查期望、自治边界和多 agent 协作方式。
validation:
- 纯文档变更，未修改代码路径
next:
- 维护者审查初始自治维护模型
- 后续 agent 可选择 `TASK-002`，或根据仓库现实继续细化队列
blockers:
- none

## 2026-04-24 05:03 UTC
task: TASK-008
agent: coordinator (direct)
branch: codex/TASK-008-boot34-35-compat
status: ready → review
summary:
- springdoc-openapi-jakarta 3.0.1 → 2.8.9
- jakarta-starter/boot3-jakarta-app Boot 4.0.1 → 3.4.5 覆盖去除
- 新增 boot35-jakarta-app smoke 模块（Boot 3.5.0）
validation: ./scripts/test-java.sh → BUILD SUCCESS
next: 维护者审查 PR #10
blockers: none

## TASK-015 — 2026-04-25
- branch: codex/TASK-015-react-swagger-models
- PR: https://github.com/songxychn/knife4j-next/pull/17
- 状态: review
- 验证: npm run build ✓
- 内容: 重写 Schema.tsx，Collapse+Table 展示 components.schemas，支持嵌套字段

## TASK-017 — 2026-04-25
- branch: codex/TASK-017-real-api-data
- PR: https://github.com/songxychn/knife4j-next/pull/18
- 状态: review
- 验证: npm run build ✓
- 内容: 新增 types/swagger.ts + api/knife4jClient.ts，重写 GroupContext 接真实数据，Schema.tsx 消费真实 schemas

## TASK-019 — 2026-04-25
- branch: codex/TASK-019-react-global-param
- PR: https://github.com/songxychn/knife4j-next/pull/20
- 状态: review
- 验证: npm run build ✓（由 claude-worker 执行）
- 内容: GlobalParamContext.tsx + GlobalParam.tsx（表格+新增表单）+ App.tsx 注册

## TASK-020 — 2026-04-25
- branch: codex/TASK-020-react-home
- PR: https://github.com/songxychn/knife4j-next/pull/21
- 状态: review
- 流程: worker → reviewer（发现 paths null safety 问题）→ worker fix → build ✓
- 内容: Home.tsx，API info + method 统计，paths/?? {} guard，info fallback

## 2026-04-25 14:29 CST
task: ad-hoc telegram bot avatar
agent: codex
branch: codex/ad-hoc-telegram-avatar
status: done
summary:
- 基于 `docs-site/public/knife4j-next-mark.svg` 的文档折角与蓝色 `N` 主体，生成 Telegram 机器人头像资产。
- 新增圆角蓝色渐变背景、轻量装饰线和右下角纸飞机徽章，保证小尺寸头像可识别。
validation:
- `sips -g pixelWidth -g pixelHeight docs-site/public/assets/knife4j-next-telegram-bot-avatar.png` 确认为 512x512。
next:
- 如需启用，可将 PNG 上传为 Telegram Bot 头像。
blockers:
- none

## 2026-04-25 16:05 CST
task: ad-hoc react doc.html starter demo
agent: codex
branch: codex/ad-hoc-react-doc-html-router
status: done
summary:
- 排查 `knife4j-demo` 集成 starter 后访问 `/doc.html` 出现 React Router `Unexpected Application Error! 404 Not Found`。
- 确认后端 `/doc.html`、`/v3/api-docs` 和 React 静态资源均返回 200，问题源于 Browser history 将 `/doc.html` 当作前端路由匹配。
- 将 React router 改为 hash router，并把 logo 路径改为 webjar 相对路径，适配 starter 静态资源部署。
validation:
- `mvn -pl knife4j-demo -am -DskipTests package` → BUILD SUCCESS
- `curl http://localhost:8080/doc.html` → 200
- `curl http://localhost:8080/v3/api-docs` → 200
- `curl http://localhost:8080/webjars/knife4j-ui-react/assets/index.js` → 200，且打包产物包含 `createHashRouter`
next:
- 本地 demo 已使用修复后的 jar 在 8080 运行，可访问 `http://localhost:8080/doc.html`。
blockers:
- none

## 2026-04-25 16:08 CST
task: ad-hoc react api doc blank pane
agent: codex
branch: codex/ad-hoc-react-doc-html-router
status: done
summary:
- 排查接口菜单点击后文档主体空白，确认原因是 App 只维护 Tab 标题和路由跳转，没有在 Tab 内容区渲染 React Router `Outlet`。
- 在当前激活 Tab 中渲染 `Outlet`，并让接口菜单点击默认进入 `/:group/:tag/:operationId/doc` 文档页。
- 为 hash router 增加 index 首页路由，避免首次打开 `/doc.html` 时内容区为空。
validation:
- `npm run build` → 成功
- `mvn -pl knife4j-demo -am -DskipTests package` → BUILD SUCCESS
- `curl http://localhost:8080/doc.html` → 200
- `curl http://localhost:8080/v3/api-docs` → 200
- `curl http://localhost:8080/webjars/knife4j-ui-react/assets/index.js` → 200，且打包产物包含文档页内容与 hash router
next:
- 本地 demo 已使用补充修复后的 jar 在 8080 运行，可刷新 `http://localhost:8080/doc.html` 后点击接口查看文档页。
blockers:
- none

## 2026-04-25 16:12 CST
task: ad-hoc react sidebar polish
agent: codex
branch: codex/ad-hoc-react-doc-html-router
status: done
summary:
- 将左侧顶部 logo 区改为产品名 `Knife4j Next`，折叠态显示 `K4N`。
- 为侧边栏搜索框增加专用暗色样式，覆盖 Ant Design 默认白底、placeholder 和清除按钮颜色。
validation:
- `npm run build` → 成功
- `mvn -pl knife4j-demo -am -DskipTests package` → BUILD SUCCESS
- `curl http://localhost:8080/doc.html` → 200
- `curl http://localhost:8080/webjars/knife4j-ui-react/assets/index.js` → 200，且打包产物包含 `Knife4j Next`
- `curl http://localhost:8080/webjars/knife4j-ui-react/assets/index.css` → 200，且打包产物包含 `knife4j-sidebar-search`
next:
- 本地 demo 已使用最新 jar 在 8080 运行，可刷新 `http://localhost:8080/doc.html` 查看侧边栏调整。
blockers:
- none

## 2026-04-25 16:17 CST
task: ad-hoc react api tabs and debug
agent: codex
branch: codex/ad-hoc-react-doc-html-router
status: done
summary:
- 修复接口 Tab 切换看起来无效的问题：文档页从 mock operation 改为按当前路由参数读取真实 OpenAPI operation。
- 新增 `useCurrentOperation` 共享 hook，用于文档页和调试页定位当前接口。
- 增加接口页内 `文档 / 调试` 切换，并将调试页接入真实 method、path、path/query/header/body 参数。
- 调试页支持同源发送请求、展示响应状态、耗时、响应体和响应 headers。
validation:
- `npm run build` → 成功
- `mvn -pl knife4j-demo -am -DskipTests package` → BUILD SUCCESS
- `curl http://localhost:8080/doc.html` → 200
- `curl http://localhost:8080/v3/api-docs` → 200
- `curl http://localhost:8080/webjars/knife4j-ui-react/assets/index.js` → 200，且打包产物包含文档/调试页文案
next:
- 本地 demo 已使用最新 jar 在 8080 运行，可刷新后验证接口 Tab 切换和调试功能。
blockers:
- none
notes:
- 构建过程改写了 `package-lock.json` 和两个 Java 文件的格式；维护者确认如属正常格式化则采纳，本次保留这些构建链输出。

## 2026-04-25 16:20 CST
task: ad-hoc react brand logo
agent: codex
branch: codex/ad-hoc-react-doc-html-router
status: done
summary:
- 在左侧品牌区 `Knife4j Next` 文案左边加回 `knife4j-next-mark.svg` logo。
- 折叠侧边栏时仅保留 logo，避免窄栏显示拥挤。
validation:
- `npm run build` → 成功
- `mvn -pl knife4j-demo -am -DskipTests package` → BUILD SUCCESS
- `curl http://localhost:8080/doc.html` → 200
- `curl http://localhost:8080/webjars/knife4j-ui-react/assets/index.js` → 200，且打包产物包含 logo 路径和 `Knife4j Next`
next:
- 本地 demo 已使用最新 jar 在 8080 运行，可刷新查看品牌区 logo。
blockers:
- none

## 2026-04-25 16:42 CST
task: ad-hoc vue2 local demo
agent: codex
branch: codex/ad-hoc-react-doc-html-router
status: done
summary:
- 确认先前访问 `http://127.0.0.1:8081/doc.html` 看到的不是 Vue2 Knife4j，而是 Vue2 devServer 的 `/` 代理把 `/doc.html` 转发给了后端 React 静态资源。
- 使用 Node 17 + Yarn 构建 `knife4j-vue/dist`，并启动临时 Express 静态代理服务：`/doc.html` 和 `/webjars` 来自 Vue2 dist，其余 API 代理到 `http://127.0.0.1:17812`。
validation:
- `yarn run build` in `knife4j-vue` → 成功（仅 webpack size warning）
- `curl http://127.0.0.1:8081/doc.html` → 200，返回 Vue2 dist `webjars/js/app.*.js`
- `curl http://127.0.0.1:8081/v3/api-docs` → 200 `application/json`
next:
- 当前真正的 Vue2 对比页面为 `http://127.0.0.1:8081/doc.html`，后端 demo 代理目标为 `http://127.0.0.1:17812`。
blockers:
- none

## 2026-04-25 16:52 CST
task: ad-hoc react/vue2 capability parity planning
agent: codex
branch: codex/ad-hoc-react-doc-html-router
status: done
summary:
- 根据维护者要求，将 React 前端下一阶段目标调整为优先复原 Knife4j Vue2 版能力，而不是先追求视觉重设计。
- 在 `.agent/TASKS.md` 新增 TASK-026 至 TASK-031，按调试参数表单、requestBody、请求构造、响应面板、schema 示例生成、鉴权/全局参数接入拆分。
validation:
- 纯任务队列与进度文档更新，未运行代码构建。
next:
- 建议优先执行 TASK-026：React 调试页按 OpenAPI 参数定义渲染填参表单。
blockers:
- none

## 2026-07-03 CST
task: docs-site-overhaul
agent: coordinator (direct)
branch: codex/TASK-027-docs-site-overhaul
status: review
summary:
- 全面重写 VitePress 文档站，对齐并超越上游 knife4j 文档深度
- 新建 5 个指南页：gateway 聚合、Disk/Nacos/Eureka 聚合、WebFlux 接入、Demo 预览、FAQ
- 新建 4 个参考页：version-ref、configuration、annotations
- 重写 5 个现有页：introduction、getting-started、migration、compatibility、modules
- 重写 release-notes 和 roadmap
- 更新 .vitepress/config.ts 侧边栏和导航结构
validation:
- cd docs-site && npm ci && npm run build → build complete in 3.20s
next:
- 提交 PR，等待维护者审查
blockers:
- none

## 2026-04-25 18:50 CST
task: TASK-032
agent: coordinator (direct)
branch: codex/TASK-032-core-debug-model
status: review
summary:
- 在 knife4j-core 新增 `debug` 模块，包含 5 个文件：
  - `types.ts`：统一类型定义（ParamIn, DebugParam, BodyContent, OperationDebugModel, DebugFormValues, AuthValues, BuiltRequest, ValidationError 等）
  - `resolveRef.ts`：`resolveRef()` + `dereference()` 统一 OAS2/OAS3 的 $ref 解析
  - `operationDebugModel.ts`：`buildOperationDebugModel()` 将 OpenAPI operation 解析为调试模型，同时兼容 OAS2 和 OAS3
  - `requestBuilder.ts`：`buildRequest()` + `buildCurl()` + 辅助函数（replacePathParams, buildQueryString, mergeHeaders, authToHeaders, splitGlobalParams, validateRequired）
  - `schemaExample.ts`：`buildSchemaExample()` 简易版 + `buildSchemaFieldTree()` 占位版（完整实现留给 TASK-030）
- 新增 3 个测试文件（resolveRef.test.ts, operationDebugModel.test.ts, requestBuilder.test.ts），覆盖 OAS2/OAS3 参数解析、$ref 解析、path 替换、query/header 合并、required 校验、curl 转义等
- knife4j-core `src/index.ts` 新增 `export * from './debug'`
- knife4j-ui-react `ApiDebug.tsx` 重构，消费 knife4j-core 的 `buildOperationDebugModel`, `buildRequest`, `buildCurl`, `validateRequired`，移除内联解析逻辑
- 新增 cURL 命令展示 Tab
- knife4j-ui-react 通过本地 tgz 依赖接入 knife4j-core
validation:
- `cd knife4j-front/knife4j-core && npx jest --config jestconfig.json` → 11 suites, 82 tests passed
- `cd knife4j-front/knife4j-ui-react && npm run build` → tsc + vite build 成功
next:
- 等待维护者 review
- TASK-032 完成后可解除 TASK-026 ~ TASK-031 的 blocked 状态
blockers:
- none

## 2026-04-25 19:00 CST
task: TASK-034
agent: coordinator (direct)
branch: codex/TASK-034-knife4j-front-workspaces
status: review
summary:
- 在 `knife4j-front/` 新增根 `package.json`，声明 `workspaces: ["knife4j-core", "knife4j-ui-react"]`
- 将 `knife4j-ui-react/package.json` 中的 `"knife4j-core": "file:knife4j-core-1.0.0.tgz"` 改为 `"*"`（workspace symlink 自动解析）
- 删除两份 `knife4j-core-1.0.0.tgz` 和两份子项目 `package-lock.json`
- 在 `knife4j-front/` 根目录运行 `npm install` 成功，生成统一 `package-lock.json` 和 `node_modules`
- `node_modules/knife4j-core` → `../knife4j-core` symlink 正确建立
- 更新 `scripts/test-front-core.sh` 为 workspace 命令（`npm ci` + `npm test -w knife4j-core` 等）
- 更新 `.agent/RUNBOOK.md` 的 Front Core 章节说明
- 给 `knife4j-core/tsconfig.json` 添加 `"skipLibCheck": true`，解决 workspace 依赖提升导致的 `@types/node` 版本冲突
- 给 `knife4j-ui-react/vite.config.ts` 添加 `optimizeDeps.include` 和 `commonjsOptions`，解决 CJS workspace 包的 Rollup 命名导出问题
- 修复 `debug/` 模块遗留 lint 错误（resolveRef `==` → `===`，operationDebugModel 去掉不必要的类型断言和非 null 断言，schemaExample 去掉未使用的 import）
- 给 `.gitignore` 添加 `*.tgz` 规则
validation:
- `./scripts/test-front-core.sh` → 11 suites, 82 tests passed, 0 lint errors, tsc build 成功
- `npm run build -w knife4j-ui-react` → tsc + vite build 成功（dist 1.26MB）
next:
- 等待维护者 review
blockers:
- none
notes:
- `knife4j-ui/`（ant-design-pro，用 pnpm）不纳入 workspace，避免 lockfile 冲突
- 回滚路径：还原 `knife4j-front/package.json`、两份 tgz、两份 lockfile、`scripts/test-front-core.sh`
- 开发流程变化：修改 knife4j-core 后不再需要 `npm pack` + 手动覆盖 tgz + 删 lockfile，symlink 实时生效

## 2026-04-25 19:40 CST
task: TASK-026
agent: coordinator (direct)
branch: codex/TASK-026-react-debug-params
status: review
summary:
- 重写 `knife4j-ui-react/src/pages/api/ApiDebug.tsx` 的参数渲染层，直接消费 knife4j-core 的 `OperationDebugModel`
- 表单状态从 `ParamRow[]` 改为 `Record<string, string>`（key 为 `${in}:${name}`），避免跨位置的名字冲突
- 新增 `ParamInput` 组件调度器，根据 `DebugParam.type / enum` 动态选择输入组件：
  - `enum` → `Select` 单选
  - `boolean` → `Switch`（底层存 'true'/'false' 字符串）
  - `integer`/`number` → `InputNumber`
  - `array`/`object` → `TextArea`（JSON 占位）
  - 其他 → `Input`（readOnly 参数自动禁止编辑）
- 初始值按 `example > default > 类型空值` 优先级生成
- 新增 `ParamNameCell` 组件，为 `deprecated`（删除线 + 「已废弃」Tag）和 `readOnly`（「只读」Tag）打独立样式
- 表格列扩展为 `参数名 / 类型（含 format）/ 值 / 说明（含默认值 / 示例 / 枚举前 3 个）`
- 新增 Cookie Tab（之前只有 path/query/header/body）
- Tab 默认激活第一个非空分类，无参数的 Tab 显示 disabled
- `handleSend` 通过 `collectFormValues` 输出完整 `DebugFormValues`（含 cookie），交给 `buildRequest` 组装
validation:
- `./scripts/test-front-core.sh` → 11 suites, 82 tests passed, 0 lint errors
- `npm run build -w knife4j-ui-react` → tsc + vite build 成功（dist 1.30MB，+35KB 来自 InputNumber/Switch）
next:
- 等待维护者 review
- 后续 TASK-027 ~ TASK-031 可在 review 过程中并行推进（本分支已堆在 TASK-034 之上）
blockers:
- none
notes:
- 本任务不改 requestBody 的 Body Tab 渲染（仅保留 TextArea 展示初始 exampleValue），multipart/urlencoded 独立表单在 TASK-027 中落地
- 本任务不改 bundler 配置，不引入新依赖（InputNumber/Switch/Tooltip 来自既有 `antd`）

## 2026-04-25 20:20 CST
task: TASK-035
agent: coordinator (direct)
branch: codex/TASK-035-node22-upgrade
status: review
summary:
- `.nvmrc` 从 `20` 改为 `22`（Node 22 Active LTS，维护至 2027-04）
- `.github/workflows/build.yml` 中 `node-version: "20"` 统一为 `node-version-file: .nvmrc`（单一真相源）
- 修 TASK-034 遗留的 CI 破损：
  - `java-build-test` job 的 `cache-dependency-path` 从不存在的 `knife4j-front/knife4j-ui-react/package-lock.json` 改为 `knife4j-front/package-lock.json`
  - `java-build-test` job 的安装步骤从 `cd knife4j-front/knife4j-ui-react && npm install` 改为 `cd knife4j-front && npm ci`（workspace root）
  - `front-core-test` job 的 `cache-dependency-path` 同步修正
- `knife4j-front/package.json` 新增 `"engines": { "node": ">=22" }`
- 本地 Node 22.22.2 下四组验证全部通过
- `package-lock.json` 仅因新增 engines 字段变化 5 行，无版本解析差异
validation:
- `./scripts/test-front-core.sh` → 11 suites, 82 tests, 0 lint errors, tsc OK
- `cd knife4j-front/knife4j-ui-react && npm run build` → tsc + vite build OK (3.33s)
- `./scripts/test-docs.sh` (knife4j-doc Docusaurus) → Client 26.71s, Server 31.08s, SUCCESS
- `cd docs-site && npm run build` (VitePress) → 6.39s, OK
next:
- 等待维护者 review
blockers:
- none
notes:
- 发现 `npm run build -w knife4j-ui-react` 从 workspace root 执行时 `tsc: command not found`，这是 npm workspace PATH 行为的已知问题（子项目 .bin 不提升到 root PATH）；从子项目目录执行则正常
- CI 不受此影响（java-build-test job 只做 npm ci，不跑 build；front-core-test 用的是 knife4j-core 的 tsc，被提升到 root）
- 不引入 Node 22 新特性到业务代码，保持现有 jest/vite 工具链

## 2026-04-25 11:47 UTC
task: TASK-023
agent: coordinator (heartbeat)
branch: codex/TASK-023-ui-react-integration
status: done
summary:
- PR #25 已合并（2026-04-25T06:55:52Z）
- knife4j-ui-react 产物打包进 knife4j-openapi3-ui 完成
next:
- TASK-024、TASK-025 解锁为 ready

## 2026-04-25 11:47 UTC
task: TASK-024
agent: coordinator (heartbeat)
branch: codex/TASK-024-settings-panel
status: done
summary:
- PR #28 已合并（2026-04-25T07:25:05Z）
- Header 设置抽屉（Authorize/GlobalParam/OfflineDoc）完成
next:
- none

## 2026-04-25 11:47 UTC
task: TASK-032
agent: coordinator (heartbeat)
branch: codex/TASK-032-core-debug-model
status: done
summary:
- PR #37 已合并（2026-04-25T10:57:32Z）
- knife4j-core 调试/解析层抽取完成
next:
- TASK-026、TASK-030 解锁为 ready

## 2026-04-25 11:47 UTC
task: TASK-034
agent: coordinator (heartbeat)
branch: codex/TASK-034-knife4j-front-workspaces
status: blocked
summary:
- PR #36 已关闭未合并（CLOSED）
- npm workspaces 迁移未完成
blockers:
- PR 被关闭，需重新评估或重新实现

## 2026-04-25 11:47 UTC
task: TASK-035
agent: coordinator (heartbeat)
branch: codex/TASK-035-node22-upgrade
status: blocked
summary:
- 依赖 TASK-034 未合并，TASK-035 重新标为 blocked
blockers:
- TASK-034 PR 关闭未合并

## 2026-04-25 状态同步
task: TASK-026/034/035
agent: coordinator
status: done
summary:
- TASK-026（调试页参数表单）：代码已在 master@3056e407，状态更新为 done
- TASK-034（npm workspaces）：代码已在 master@6572a458，状态更新为 done
- TASK-035（Node 22 升级）：代码已在 master@2617c72f，状态更新为 done
- 解锁 TASK-027（requestBody 多内容类型表单）和 TASK-030（schema 示例生成）为 ready

## 2026-07-04 CST
task: TASK-030
agent: coordinator (direct)
branch: codex/TASK-030-schema-example-builder
status: review
summary:
- 完整实现 buildSchemaExample(schema, ctx) 和 buildSchemaFieldTree(schema, ctx)
- 支持 $ref、object、array、enum、example、default、allOf、oneOf、anyOf（后两者取第一个可解析分支）
- 循环引用通过引用链数组截断，重复引用以占位值兜底
- maxDepth 保护（默认 8），超过截断并附 truncated 标记
- OAS2 definitions 与 OAS3 components.schemas 统一抽象
- 新增 SchemaFieldNode 类型定义
- 新增 schemaExample.test.ts（39 个用例覆盖各种分支）
validation:
- 12 test suites, 121 tests pass
- lint 0 errors, tsc build OK
- 分支已推送，等待创建 PR
next:
- 等待维护者 review PR
blockers:
- gh CLI 未安装，PR 需通过 GitHub 网页创建

## 2026-07-04 CST
task: TASK-027
agent: coordinator (direct)
branch: codex/TASK-027-react-debug-request-body
status: review
summary:
- 重写 ApiDebug.tsx 的 Body Tab，实现 requestBody 多内容类型表单
- 新增 BodyTab 组件：根据 content-type 分类渲染不同表单
  - JSON 模式：可编辑 TextArea + Beautify 按钮（接入 buildSchemaExample 生成的 exampleValue）
  - urlencoded 模式：从 schema.properties 提取字段行，渲染参数表格（SchemaFieldInput 调度器）
  - multipart 模式：普通字段表单 + 文件字段使用 antd Upload 组件（支持多文件）
  - raw 模式：Text/JSON/JavaScript/XML/HTML 五种子模式切换 + Beautify
- Radio.Group 切换 content-type（多 content-type 时显示）
- 新增 selectedContentType / formFields / fileFields 状态管理
- collectFormValues 传递 selectedContentType / formFields / fileFields 给 requestBuilder
- handleSend 对 multipart 场景手动构建 FormData（浏览器自动设 boundary）
- 新增辅助函数：extractSchemaFields, initialFieldValue, SchemaFieldRow 类型
- i18n 补全 7 个新文案（中英文）
validation:
- knife4j-core: 12 suites, 121 tests pass
- knife4j-ui-react: npm run build 通过 (tsc + vite build, dist 1.44MB)
next:
- 等待维护者 review
- PR: https://github.com/songxychn/knife4j-next/pull/44
blockers:
- none

## 2026-04-25 15:10 UTC
task: TASK-028
agent: knife4j-next-bot
branch: codex/TASK-028-react-debug-request-builder
status: review
summary:
- knife4j-core: ValidationError 新增 `key` 字段（格式 `${in}:${name}` / `body:requestBody`），便于 UI 定位
- knife4j-core: validateRequired 增强 body 必填判定，兼容 urlencoded/multipart（formFields/fileFields 为空才报错）
- knife4j-core: buildCurl 增强 multipart/form-data 处理——解析 body 的文本字段输出 `-F`，并附 TODO 注释提示附加文件字段；同时跳过 Content-Type 头避免 boundary 冲突
- knife4j-core: 扩展测试覆盖 urlencoded/multipart 必填校验、multipart curl 生成（12 suites / 124 tests）
- ApiDebug: 新增独立『请求预览』Tab（PreviewTabPanel），实时展示最终 URL、method、headers、query、body 与等价 cURL；支持一键复制 cURL（clipboard + textarea 兜底）
- ApiDebug: 发送前调用 core 侧 validateRequired，缺失必填字段时 setValidationErrors + 自动切换到对应 Tab（`in` 映射到 Path/Query/Header/Cookie/Body Tab）
- ApiDebug: ParamInput 透传 hasError，根据 errorKeys 给缺失输入项 `status="error"` 红框
- ApiDebug: Tabs 改受控（activeTab/currentActiveTab），移除响应面板原 cURL 子 Tab（已并入请求预览）
- 预览与发送共用同一 buildPreview()（coreBuildRequest + buildCurl），确保 UI 展示与真实请求一致
- i18n 补全 14 个预览相关文案（中英文），覆盖 tab.preview / preview.*（method/url/headers/query/body/bodyMultipart/noBody/curl/copyCurl/copied/copyFailed/autoContentType）
validation:
- ./scripts/test-front-core.sh → 12 suites / 124 tests pass；lint 0 errors；tsc build OK
- cd knife4j-front && npm run build -w knife4j-ui-react → tsc + vite build 通过（dist 1.44MB）
next:
- 推送分支、创建 PR 等待维护者 review
blockers:
- none

## 2026-04-25 状态同步
task: TASK-027/028/030 合并确认
agent: coordinator (heartbeat)
status: done
summary:
- TASK-030（schema 示例生成）：PR #43 已合入 master@87745b54
- TASK-027（requestBody 多内容类型表单）：PR #44 已合入 master@7ec205d5
- TASK-028（发送前校验与请求预览）：PR #45 已合入 master@1b940a3b
- 三者对应 TASKS.md 条目状态更新为 done + merged_into
- 下游解锁：
  - TASK-029（响应面板对齐 Vue2）：blocked → ready
  - TASK-031（接入鉴权/全局参数）：blocked → ready（TASK-018/019 已 done）
  - TASK-033（securitySchemes 动态渲染）：blocked → ready（所有前置已 done）
next:
- 建议顺序：TASK-029（响应面板）→ TASK-031（鉴权/全局参数合并）→ TASK-033（securitySchemes）
- 三者均为 ui-react 窄范围任务，可独立成 PR，无需再等前置依赖
blockers:
- none

## 2026-04-26 CST — 三任务并行分派
task: TASK-029 / TASK-031 / TASK-033
agent: coordinator + 3 workers (general-agent)
status: review
summary:
- 并行分派 3 个 worker（TASK-029 响应面板、TASK-031 鉴权+全局参数合并、TASK-033 securitySchemes 动态渲染）
- 预先规划文件所有权边界，约束每个 worker 的可改/禁改范围，降低 merge 冲突
- TASK-031 和 TASK-033 共享 `requestBuilder.ts` / `types.ts` / `ApiDebug.tsx`：
  - TASK-031 扩展 authToHeaders 返回 `{ headers, queries }`、新增 sourceMap、ApiDebug 消费 auth + globalParams
  - TASK-033 基于 TASK-031 之上，扩展 AuthValues.bySecurityKey、authToHeaders(securityKeys?) 选择注入、ApiDebug 传入 securityKeys
  - 两者叠加正确，TASK-033 保留了 TASK-031 的 sourceMap / source Tag 功能
- 中途坑：worker 运行在共享 workspace，首轮 TASK-031/033 worker 均未 commit 导致 TASK-033 改动被覆盖；重派 TASK-033 时强制要求 commit + 返回 hash
- 最终提交：
  - TASK-029: e6aff14b（基于 master）
  - TASK-031: 051001a9（基于 master）
  - TASK-033: 31579eba（stacked on TASK-031 051001a9）

## TASK-029 详情
branch: agent/TASK-029-react-debug-response-panel
PR: https://github.com/songxychn/knife4j-next/pull/47
summary:
- 抽出独立 ResponsePanel 组件（pages/api/ResponsePanel.tsx）
- 响应区顶栏：status + statusText + method + 耗时 + 响应体大小（blob.size）
- Content / Raw / Headers 三个子 Tab
- Content Tab 按 Content-Type 分流：image/* → img 预览；application/json → 格式化 JSON；text/xml/yaml/javascript → 文本；其他二进制 → 下载链接
- Raw Tab：原始文本 + 复制按钮（clipboard API + textarea 兜底）
- Headers Tab：antd Table
- 错误以 Alert 置顶，Tab 结构保留
- fetch 响应改为读一次 Blob 再分类（interpretResponseBlob），revoke 旧 objectURL
- 新增 apiDebug.response.* i18n 键
- 无新依赖；cURL 不重复（已在 Preview Tab）
validation:
- ./scripts/test-front-core.sh → 12 suites / 124 tests pass（未动 core）
- npm run build -w knife4j-ui-react → OK

## TASK-031 详情
branch: agent/TASK-031-react-debug-auth-global-param
PR: https://github.com/songxychn/knife4j-next/pull/46
summary:
- knife4j-core types: 新增 ParamSource、BuiltRequestSourceMap；BuiltRequest.sourceMap 可选
- knife4j-core requestBuilder: authToHeaders 返回 `{ headers, queries }`；buildRequest 按 interface > global > auth 合并并生成 sourceMap
- ApiDebug 消费 useAuth + useGlobalParam，转换为 AuthValues / GlobalParamValues 传给 coreBuildRequest
- PreviewTabPanel 为每行 header/query 渲染 source Tag
- locales 新增 apiDebug.preview.source.{interface,global,auth}
- 测试：+10 用例（sourceMap、接口覆盖全局、auth 冲突等）
- AuthContext / Authorize / GlobalParam UI **未动**，留给 TASK-033 叠加
validation:
- ./scripts/test-front-core.sh → 12 suites / 134 tests pass（+10）
- npm run build -w knife4j-ui-react → OK

## TASK-033 详情
branch: agent/TASK-033-authorize-security-schemes
PR: https://github.com/songxychn/knife4j-next/pull/48
base: 051001a9（stacked on TASK-031）
commit: 31579eba
summary:
- knife4j-core types: SchemeValue 联合类型 + AuthValues.bySecurityKey（可选，向后兼容）
- knife4j-core requestBuilder: authToHeaders(auth, securityKeys?) 支持按 operation.security 筛选注入 apiKey/http/oauth2；base64Encode 纯 JS（TextEncoder + btoa）
- AuthContext: state schema 改为 Record<groupId, Record<securityKey, SchemeValue>>；idb-keyval 持久化；一次性迁移旧 localStorage
- Authorize.tsx: 按 securitySchemes 动态渲染（apiKey / http-bearer / http-basic / oauth2-password / oauth2-clientCredentials）；implicit + authorizationCode 明确不实现，UI 标注
- ApiDebug.buildPreview: 提取 operation.security → securityKeys 传给 coreBuildRequest
- swagger.ts: 新增 SecuritySchemeObject / OAuth2Flow / OAuth2Flows 类型
- i18n: +46 个 auth.schemes.* / auth.oauth2.* 中英文
- 新增 idb-keyval 依赖
- 测试：+13 用例
validation:
- ./scripts/test-front-core.sh → 12 suites / 147 tests pass（+13）
- npm run build -w knife4j-ui-react → OK (dist 1.46MB)

next:
- 等待维护者 review 三个 PR（建议顺序：TASK-029 / TASK-031 独立可并，TASK-033 需 TASK-031 先合）
blockers:
- none

notes:
- TASK-033 worker 违反「禁改 .agent/」约束，自行写入了状态（已由 coordinator 整合重写，保留有价值内容）
