---
title: 发布说明
---

# 发布说明

本页记录 knife4j-next 所有版本的变更。

> 判断"值不值得升"？对照 [兼容矩阵](/reference/compatibility) 和 [迁移指引](/guide/migration)。

---

## knife4j-next 版本

### 5.0.4 <Badge type="tip" text="最新" />

`5.0.4` 是基于 `5.0.3` 的补丁版本，重点补强 GitHub Release 发布门禁、release note 抽取边界，以及 React UI 在普通 HTTP / 局域网访问下的全局参数兼容性。

**发布流程**

- Release workflow 限定只在 `v*` tag 上运行，并在 Maven Central 发布成功后自动创建或更新 GitHub Release；发布流程会校验 GitHub Release 存在，且正文与 `docs-site/release-notes/index.md` 中对应版本小节一致（PR #381）。
- 修复 release note 抽取脚本的章节边界判断；回补旧 tag 或重建旧 Release 时，目标版本位于 `knife4j-next 版本` 列表末尾也不会把 `## 历史版本` 和上游说明带进 Release body（PR #383）。

**前端（React UI）**

- 全局参数添加不再直接依赖 `crypto.randomUUID()`；在普通 HTTP、局域网 IP 或旧环境中缺少该 API 时，会依次回退到 `crypto.getRandomValues()` 或本地临时 ID，避免按钮 loading 卡住且参数无法添加（PR #382）。
- 清理 Ant Design Modal 弃用属性，并启用 React Router `v7_startTransition` future flag，减少本地运行时告警（PR #382）。

**本地开发体验**

- 调整 Vite dev 代理，保留 dev server 的 Host。通过局域网 IP 访问 `:5180` 时，springdoc 生成的调试地址不再误指向浏览器侧 `localhost:8080`（PR #382）。

### 5.0.3

`5.0.3` 是基于 `5.0.2` 的补丁版本，重点收口 5.0.2 Boot4 starter 发布清单、调试器 baseUrl 解析、双前端首页体验、协作门禁和 README 产品示例。

**后端 & 发布**

- 修复 Maven Central 发布模块清单，新增 `scripts/release-modules.txt` 与 `scripts/verify-release-modules.sh`，并在 Build / Release workflow 中校验 BOM 与发布模块一致，避免新增可发布模块时漏发（PR #370）。
- 同步 5.0.2 发布后的文档说明，明确 Boot4 starter 构件已补发并可从 Maven Central 直接拉取（PR #373）。

**前端（React UI）**

- 调试器请求 baseUrl 支持 operation-level 与 path-level `servers`，优先级为 `setting.enableHost` 覆盖 > operation `servers` > path item `servers` > root `servers` > 当前 UI origin，并补充回归测试（PR #374）。
- 修复 HTTPS 页面调试同域接口时被错误降级到 HTTP 的问题；同源相对地址保持当前页面协议，跨域或显式 server URL 则保持文档声明的协议（PR #377）。
- 美化 React 首页信息层级，展示文档标题、版本、分组和接口统计，并避免加载期显示无意义占位数据（PR #376）。

**前端（Vue3 UI）**

- 同步 Vue3 首页视觉与信息展示，补齐 `Knife4j Next` 品牌标识和多语言文案，使 OAS2 兼容前端与 OAS3 主线前端保持更一致的首屏体验（PR #376）。

**文档 & 流程**

- 强化 coordinator / worker / reviewer 门禁，明确 `status:review` 必须在本地验证、独立审查和 PR CI 通过后才能设置，并把规则同步到 `.agent/`、`AGENTS.md` 与 PR 模板（PR #375）。
- README 增加 OpenAPI 文档概览、接口文档详情和在线调试产品截图，替换过时示例图，便于新用户快速判断当前 UI 状态（PR #378）。

### 5.0.2

`5.0.2` 是基于 `5.0.1` 的补丁版本，集中修复 Boot4 starter 发布清单、BOM 缺漏、React UI 路由守卫与配置默认值的对齐、调试器细节，以及前端解析层的 cookie 大小写合并。

**后端 & 打包**

- `knife4j-dependencies` BOM 补登 `knife4j-openapi3-boot4-spring-boot-starter`（PR #362），下游通过 BOM 引入 Boot4 starter 时不再需要显式声明版本。
- 修复 release workflow 的 Maven Central 发布模块清单，避免新增可发布模块时漏发；`knife4j-openapi3-boot4-spring-boot-starter:5.0.2` 已补发完成，可从 [Maven Central](https://repo1.maven.org/maven2/com/baizhukui/knife4j-openapi3-boot4-spring-boot-starter/5.0.2/) 直接拉取（PR #370）。

**前端（React UI）**

- 修复 `enableSwaggerModels=false` 时直接刷新 `/:group/schema` 会导航到非法 `//home` 的问题，路由守卫优先使用 `useParams` 的 `:group` 再回退到 `activeGroup`（PR #366 / #367）。
- Schema 页在 `enableSwaggerModels=false` 时显示 403 提示而非空白，并防止通过 URL 参数注入被禁用的标签；hooks 调用顺序修正，补齐 zh-CN / en-US / ja-JP 三语翻译（PR #364，#358 review）。
- 调试器 raw body 体验完善（PR #357）：raw 模式下拉项展示完整 MIME（如 `JSON(application/json)`、`Text(text/plain)`），Beautify 由仅支持 JSON 扩展为 JSON / XML / HTML / JavaScript 多格式，无法解析时提示 `apiDebug.body.beautifyFailed`，body Tab 标题展示 effective content-type；并改用基于正则的标签边界切分 + DOMParser 校验，避免文本中的 `<` / `>` 被误判为标签起止（PR #364，#357 review）。
- 调试器请求 baseUrl 智能解析（PR #363）：优先级调整为 `setting.enableHost` 覆盖 > OpenAPI `servers[0].url` > 当前 UI origin，便于反向代理 / 前后端分离部署直接复用文档侧给出的 server URL。
- React 设置面板默认值与后端 starter 默认行为对齐，并能从 OpenAPI 文档中读取 `enableHost` / `enableHostText` 等服务端注入项（PR #358）。

**前端解析层（knife4j-core）**

- `requestBuilder.appendCookieParams` 与 `authToHeaders` 中的 cookie apiKey 拼接按 RFC 7230 大小写不敏感地查找已有 Cookie 头，避免同时输出 `cookie` 与 `Cookie` 两个键，新增 2 条回归测试（PR #365，#352 review）。

**协作 & 流程**

- 持久化中文协作规范（PR #360）。

### 5.0.1

`5.0.1` 是基于 `5.0.0` 的补丁版本，重点补齐 `doc.html` 访问、Boot4 WebMVC 适配、反向代理路径、前端显示和文档站同步。

**后端 & 打包**

- 新增 Spring Boot 4 WebMVC 专用 starter（`knife4j-openapi3-boot4-spring-boot-starter`），适配 springdoc-openapi 3.0.3。
- 修复 OpenAPI3 自定义 `api-docs.path` / `swagger-config` 发现逻辑，覆盖反向代理 prefix 和 forwarded header 场景。
- 新增 `/knife4j/config` 作为 Knife4j UI 内部运行时发现入口，支持自定义 `springdoc.api-docs.path`，并从 OpenAPI 文档中隐藏。
- 回退 `addCustomApiDocsPathRule` 误修，避免在 basic auth 场景下额外保护自定义 api-docs 路径。
- OAS2 webjar 改为使用 `Knife4jSpringUi` 构建产物，恢复 Vue3 UI 的 Spring starter 入口一致性。
- 增加 OpenAPI2 demo，并补齐 `/v3/api-docs/swagger-config` 兼容端点与启动日志依赖。

**前端**

- 修复 tag / operationId 含特殊字符时的路由编码问题。
- 切换分组时清空搜索词，避免跨分组搜索状态残留。
- 修复 schema 泛型标题、`string + byte` 类型识别、缺失 `type` 字段时的参数类型推断。
- 优化 JSON 字段描述展示，避免复制响应结构时带入字段注释。
- 整理 React 与 Vue3 API 文档 UI 的细节表现。

**文档 & 流程**

- 更新反向代理 prefix、Nginx 斜杠规则、Boot 2 / Boot 3 差异说明。
- 同步 demo 镜像命名、文档站当前实现状态和 upstream issue 复现优先的 PR 规则。

### 5.0.0

knife4j-next 首个正式稳定版本。整合了 Preview 阶段（4.6.0.3）和 1.0.0 的全部工作，并在此基础上继续修复和增强。

**前端（knife4j-ui-react）**

- 国际化：支持 zh-CN / en-US / 日语三语切换
- ApiDebug：类型感知输入（enum→Select、boolean→Switch、number→InputNumber、array→TextArea）
- ApiDebug：多 content-type 请求体（JSON / form-data / x-www-form-urlencoded）
- ApiDebug：发送前 cURL 预览、响应体复制 / 下载 / 大小显示
- ApiDebug：认证 & 全局参数合并注入（来源标签 interface / global / auth）
- Authorize：按 securitySchemes 动态渲染，支持 OAuth2 四种 flow 的基础 token 获取 / 注入（授权码和隐式模式通过 `oauth2-redirect.html` 回跳）
- 侧边栏：接口搜索高亮 + HTTP Method 过滤 + 尊重后端 `tags-sorter` / `operations-sorter` 配置
- Tab 标签页：右键菜单（关闭当前 / 关闭其他 / 关闭全部）+ 刷新后状态持久化
- Home 页：OpenAPI 概览（接口统计、分组信息、扩展属性）
- 离线文档导出：HTML / Word / Markdown / OpenAPI JSON 四种格式
- 设置面板：整合 Authorize / GlobalParam / OfflineDoc 三个 Tab
- 修复页面加载时 Petstore 示例数据一闪而过
- 修复侧边栏 group 切换时 `groupOptions[0]` 越界
- 修复 GlobalParamProvider 需提升到 app root 才能跨页面生效

**OAS2 前端切换到 Vue 3**

`knife4j-openapi2-ui` webjar 和 `knife4j-aggregation-spring-boot-starter` 的前端产物从 upstream Vue 2 切换到本仓库 `knife4j-vue3`（Vue 3 + Vite）构建产出。访问入口、URL 格式、`localStorage` key 保持兼容，默认场景下无感知。

**后端 & 基础设施**

- Boot 3.4.0 / 3.5.0 兼容（springdoc-openapi-jakarta 升至 2.8.9）
- 修复 `/v2/api-docs;xxx` 分号绕过 Basic 认证漏洞（[#886](https://github.com/xiaoymin/knife4j/issues/886)）
- 修复 gateway `context-path` 下聚合 host 少斜杠（[#954](https://github.com/xiaoymin/knife4j/issues/954)）
- 修复 `productionSecurityFilter` 中不可达的 null-guard（OAS2）
- knife4j-core：提取 debug 解析层到独立包（82 项单元测试）
- Prettier + Spotless 格式化规范，CI 增加格式检查
- `-parameters` 编译参数：修复 Springdoc 路径参数识别

---

## 历史版本

`4.6.0.3`（Preview）和 `1.0.0` 为开发过渡版本，已停止维护。Maven Central 上的坐标仍然可用，但不推荐新项目使用。

---

## 上游 knife4j 版本（com.github.xiaoymin）

> 以下版本来自上游 `xiaoymin/knife4j`，knife4j-next 基于最后的 4.5.0 版本 fork。仅作历史参考。

### 4.5.0（2024-01-08）— 上游最终版本

- 新增日语 i18n 支持（Gitee#PR98）
- 修复 `EnvironmentPostProcessor` 与用户 `defaultProperties` 冲突（Gitee#PR100）
- **修复 Spring Boot 3 下 `@ApiOperationSupport` 的 `order` 不生效**（核心修复）
- 修复 `springdoc.group-configs.packages-to-scan` 未设置时的 NPE（Gitee#I8O7E8）
- 修复 `@Schema.description` 在实体参数上不渲染（Gitee#I8EVO3, GitHub#690）
- 修复 OpenAPI 3 请求参数 `format` 属性展示异常（Gitee#I8KRWV）

---

## 版本号说明

knife4j-next 从 `5.0.0` 起采用独立 [SemVer](https://semver.org/lang/zh-CN/) 版本号，与上游 knife4j 版本号无关。

Maven 坐标：

```xml
<dependency>
    <groupId>com.baizhukui</groupId>
    <artifactId>knife4j-openapi3-jakarta-spring-boot-starter</artifactId>
    <version>5.0.4</version>
</dependency>
```

详见 [版本参考](/reference/version-ref) 和 [迁移指引](/guide/migration)。
