---
title: 发布说明
---

# 发布说明

本页记录 knife4j-next 所有版本的变更。

> 判断"值不值得升"？对照 [兼容矩阵](/reference/compatibility) 和 [迁移指引](/guide/migration)。

---

## knife4j-next 版本

### 5.3.3 <Badge type="tip" text="最新" />

`5.3.3` 是基于 `5.3.2` 的向后兼容补丁版本，修复动态参数开关未接入表单请求体的问题。

**接口调试（React UI）**

- 开启动态参数后，`application/x-www-form-urlencoded` 与 `multipart/form-data` Body 支持增删 OpenAPI 未声明的文本字段；预览、真实请求、缓存、历史、重置和媒体类型切换共用一致行为，且本地显式设置继续优先于服务端默认值（PR #650，issue #649）。

### 5.3.2

`5.3.2` 是基于 `5.3.1` 的向后兼容补丁版本，恢复 OAS3 离线文档中的请求示例与响应示例。

**离线文档导出（React UI）**

- HTML、DOC、DOCX 与整篇 Markdown 导出重新包含请求与响应示例；支持 media type `example`、首个 named example、本地 `components.examples` 引用与 schema 生成回退，并保留仅 example 无 schema、binary 响应和 Markdown 安全 fence 等边界行为（PR #644，issue #643）。

### 5.3.1

`5.3.1` 是基于 `5.3.0` 的向后兼容补丁版本，修复 Word 导出大纲与编号，并统一离线文档的跨格式内容契约，同时提升请求参数较多时的批量操作效率。

**离线文档导出（React UI）**

- Word `.doc` / `.docx` 导出使用一致的 `tag -> API` 两级标题结构与编号；DOCX 写入原生多级编号，API 摘要缺失时回退到 `METHOD path`（PR #633，issue #632）。
- HTML、DOC、DOCX 与整篇 Markdown 统一消费格式无关的导出模型，补齐 tag / operation 描述、版本、requestBody 元数据、嵌套请求字段与响应字段，并保留既有导出范围和单接口 Markdown 契约（PR #637，issue #634）。

**接口调试（React UI）**

- Path、Query、Header 与 Cookie 参数表支持对当前可见参数全选、取消全选和半选态；批量切换只改变启用状态并保留已填写值，不影响 Body、自定义参数和注入参数（PR #636，issue #635）。

### 5.3.0

`5.3.0` 是基于 `5.2.4` 的向后兼容次版本，恢复跨 OpenAPI 分组复用请求参数的能力，并将不同作用域的配置入口拆分得更清晰。

**请求参数与鉴权（React UI）**

- 请求参数支持“全部分组”和“当前分组”两级作用域，请求构建优先级为“应用级参数 < OpenAPI 鉴权 < 当前分组参数 < 接口参数”（PR #627，issue #626）。
- 请求参数、Cookie 会话与 OpenAPI 鉴权拆分为三个独立页面；Cookie 与鉴权凭据仍严格限定在当前分组，切组、直达旧标签、文档加载失败和 OAuth2 异步完成时均保持隔离（PR #627）。
- 旧版共享参数仅在新的应用级存储不存在时迁移，减少升级后的重复配置，同时避免覆盖已保存的新配置（PR #627）。

### 5.2.4

`5.2.4` 是基于 `5.2.3` 的向后兼容补丁版本，修复 React UI 宽屏布局下 Header / 接口标签 / Footer 随 document 滚动离开视口的问题。

**布局与滚动（React UI）**

- 宽屏（>800px）固定视口布局，侧栏菜单、接口详情、Debug 主区域与历史区域分别独立滚动；窄屏保留 document 滚动回退，切换接口时复位滚动位置，并限制超长自定义 Footer 高度（PR #621，issue #620）。

### 5.2.3

`5.2.3` 是基于 `5.2.2` 的向后兼容补丁版本，修复独立聚合场景下下游文档拉取缺少路由头的问题。

**聚合与路由（React UI）**

- Nacos 等独立聚合模式加载下游 `api-docs` 时补齐 `knife4j-gateway-request` 路由头，避免下游文档 404；并限制该头仅在聚合路由请求中发送（PR #613，issue #612）。

### 5.2.2

`5.2.2` 是基于 `5.2.1` 的向后兼容补丁版本，修复调试页数组枚举与查询参数序列化、集合请求体分组校验，以及文档信息扩展字段与 JSON 示例类型展示问题。

**调试与请求体（React UI + OpenAPI3 starter）**

- 修复集合请求体字段上 `x-validation-groups` 分组校验失效的问题，后端扩展输出与前端必填判定对齐（PR #600，issue #598）。
- 数组类型枚举参数支持多选；查询参数按 OAS3 规范序列化，并收紧数组枚举取值行为（PR #601，issue #597）。

**文档展示（React UI）**

- OAS3 JSON media example 按原生类型序列化，避免数字、布尔等被错误写成字符串（PR #606，issue #604）。
- 首页文档信息移除非规范 `extensions` 包装兼容，只展示标准 `x-*` 扩展字段（PR #605，issue #603）。

### 5.2.1

`5.2.1` 是基于 `5.2.0` 的向后兼容补丁版本，修复调试页编辑器运行时错误，并完善文件下载等二进制响应的文档展示。

**响应文档（React UI）**

- 响应 Schema 会展示对应 media type；响应 Header 会展示类型、必填状态、说明与 example，并支持 `components.headers` 引用（PR #588，issue #579）。
- binary 响应未声明 example 时不再生成误导性的空字符串；显式 example 与 schema `$ref` 仍会正确展示（PR #588）。
- OpenAPI 3 demo 新增文件下载接口，覆盖实际二进制响应文档场景（PR #588）。

**调试器兼容**

- 修复重复 CodeMirror 依赖导致 JSON/XML 调试编辑器加载时报错的问题，并补充语言扩展回归测试（PR #589，issue #586）。

### 5.2.0

`5.2.0` 是基于 `5.1.0` 的向后兼容次版本，重点将 React UI 的全局参数收敛为分组级能力，支持请求取值、Cookie 会话与敏感值交互，并完成前后端兼容线依赖维护。

**分组级全局参数（React UI）**

- “全局参数”调整为当前 OpenAPI 分组级能力，并与 OpenAPI 鉴权预设统一入口；调试页会提前展示实际注入的 Header、Query 与 Cookie 参数，同名接口参数仍优先（PR #577，issue #552）。
- 参数值既可手工填写，也可由用户显式发送固定请求后通过 JSONPath 提取；支持浏览器管理的 Cookie 会话和 credentials 策略（PR #577）。
- 敏感值默认隐藏，支持复制真实值和临时显示；全局参数与调试页自定义参数统一为表格交互（PR #577）。

> 该能力仅适用于 OpenAPI 3 React UI；请求取值需用户主动触发，不自动处理 401/403、刷新或重试，也不读取 HttpOnly Cookie。

**依赖与构建维护**

- 更新 React/core、Vue3 与文档站的同主版本依赖，移除冗余 `@types/dompurify` 与 React Router v5 类型包，并同步 lockfile 和内嵌 UI 产物（PR #576）。
- Spring Boot 4 更新到 `4.0.7`、Spring Cloud Gateway 5 更新到 `2025.1.2`；Gateway Server Web MVC 使用 Spring Boot `3.5.16` 与 Spring Cloud `2025.0.3`（PR #578）。
- Boot 2 / Jakarta 聚合 starter 移除 Hutool，改用 JDK、Spring、Gson 与仓库现有工具，并以兼容测试锁定既有 MD5、空白字符、正则、JSON、线程和关闭语义（PR #580）。
- SLF4J 更新到 `2.0.18`、Lombok 更新到 `1.18.46`、JUnit Jupiter 更新到 `5.14.4`、Maven Surefire Plugin 更新到 `3.5.6`，均保留既有兼容主版本（PR #581）。

### 5.1.0

`5.1.0` 是基于 `5.0.18` 的向后兼容次版本，新增 React 嵌入式启动能力，集中增强调试与文档体验，并补齐中英日国际化链路。

**调试与文档体验（React UI）**

- React UI 支持通过 `window.__KNIFE4X_CONFIG__` 进入嵌入模式，校验 `specUrl` / `basePath`，直接加载单一 OpenAPI 3 文档且不请求 Java discovery 端点（PR #549，issue #548）。
- 响应文档示例优先展示 OpenAPI media type 中显式声明的 `example` / `examples.*.value`，没有显式示例时再回退到 schema 生成值（PR #560，issue #550）。
- 请求预览中的 Header / Query 长连续值不再撑坏表格；默认折叠为两行，可展开并复制完整值（PR #559，issue #551）。
- multipart schema `required` 声明的文件字段会在发送前校验；未选择必填文件时显示字段级错误并阻止请求（PR #570，issue #569）。
- 非 SSE 响应在接收阶段显示进度：可安全读取总长时展示百分比和总量，否则展示已接收大小（PR #571，issue #567）。

**中英日国际化**

- 后端补充 `ja-JP` 语言枚举；React 与 Vue3 统一 `zh-CN`、`en-US`、`ja-JP` 的规范化、旧缓存迁移、语言切换和 `Accept-Language` 行为，并补齐文档、Schema、导出与运行时提示等三语文案（PR #568）。

### 5.0.18

`5.0.18` 是基于 `5.0.17` 的补丁版本，新增 Spring Cloud Gateway Server Web MVC 聚合 starter，补齐 starter 发布包的 Spring Boot 配置元数据，并将提交前检查收敛为版本化 Git hook。

**Gateway Server Web MVC 聚合**

- 新增 `knife4j-gateway-webmvc-spring-boot-starter`，面向 Spring Boot 3.5 / Spring Cloud 2025.0.x 的 Gateway Server Web MVC；支持 MANUAL 路由、Basic 认证，以及只读取已配置 `lb://` + `Path` 路由的受限 DISCOVER 模式（PR #544，issue #540）。
- 新增 `boot35-gateway-webmvc-app` HTTP smoke，覆盖 MANUAL、DISCOVER、`/doc.html` 与 Basic 认证，并将 starter 纳入 BOM、发布模块清单和 CI smoke 汇总（PR #544）。

**发布产物 & 开发体验**

- 6 个含本地 `@ConfigurationProperties` 的 starter 发布 JAR 现在都会携带 `META-INF/spring-configuration-metadata.json`；新增最终 JAR 元数据门禁，确保 IDE 能识别 `knife4j.enable`、`knife4j.production` 等配置项（PR #542，issue #541）。
- 以版本化 `.githooks/pre-commit` 替换会引用旧 worktree 路径的 Lefthook；仅对暂存的 React/core 改动运行本地格式检查与 lint，CI 仍为合并门禁（PR #543）。

### 5.0.17

`5.0.17` 是基于 `5.0.16` 的补丁版本，修复 React UI 中 Tab 右键菜单误作用于文档内容区的问题，并让在线 demo 仅跟随正式发布版本更新。

**前端（React UI）**

- Tab 右键菜单的触发范围收窄到各个 Tab 标签；文档内容区右键不再弹出 Tab 关闭菜单，既有关闭当前、关闭其他和关闭全部操作保持不变（PR #537，issue #536）。

**交付 & 在线 Demo**

- 在线 demo 镜像仅在推送 `v*` 发布 tag 时构建部署，紧急情况可手动触发；`master` 合并不再自动更新，避免 demo 超前于 Maven Central 稳定版（PR #535）。

### 5.0.16

`5.0.16` 是基于 `5.0.15` 的补丁版本，重点增强 React UI 调试页按接口记录请求历史，修复自定义 Markdown 文档中超长连续英文撑开页面的问题，并完成仓库按产品线重组与文档默认 Boot4 坐标对齐。

**前端（React UI）**

- 调试页新增按接口维度的请求历史：发送时写入 `pending`，响应/失败/取消后补全；本机 `localStorage` 持久化，支持列表、详情、应用到表单、删除与清空，以及 `enableRequestHistory` 开关（PR #523）。
- 修复自定义 Markdown 文档中超长连续英文字符（如 API key）把页面横向撑开的问题；段落内可断行，代码块仅内部横向滚动（PR #531，issue #528）。

**文档 & 仓库**

- 按产品线重组 monorepo 顶层结构：前端收拢到 `front/`，文档与脚本迁至 `docs/`、`tools/`，历史模块归档到 `legacy/`，并新增 `knife4x/` 骨架（PR #525）。
- 文档站首页「60 秒上手」默认 Maven 示例切换为 Boot4 starter，并保留 Boot 3.x 示例（PR #526）。

### 5.0.15

`5.0.15` 是基于 `5.0.14` 的补丁版本，重点补齐 Boot4 独立聚合 starter，README 默认示例切换到 Boot4 坐标，并修复 React UI 调试页数值参数输入精度保留问题。

**后端 & 聚合**

- 新增 `knife4j-aggregation-boot4-spring-boot-starter`，覆盖 Spring Boot 4 独立聚合场景，并补充 `boot4-aggregation-app` smoke 验证与发布模块清单（PR #513）。

**前端（React UI）**

- 调试页数值参数输入会保留用户输入精度，避免 `1.0` 等文本过早转换成数字后丢失格式（PR #518）。

**文档 & 仓库**

- README 默认 Maven 示例切换为 Boot4 starter 坐标，并简化 Boot4 示例说明（PR #517）。
- 清理闲置历史备份文件、过时扩展占位 README，以及未启用的 Swagger2 / AsyncAPI parser 空壳，降低仓库维护噪音（PR #511）。
- 删除过期 Gitee issue 模板、Cloudflare Pages 手工部署备忘和无引用旧截图素材，减少仓库历史遗留文件（PR #520）。

### 5.0.14

`5.0.14` 是基于 `5.0.13` 的补丁版本，重点补强 React UI 在 Gateway 聚合、调试器、配置开关和请求体校验分组上的体验，并把 OpenAPI3 demo 升级到 Boot4。

**前端（React UI）**

- 修复 Gateway 聚合场景下调试 Base URL 未优先带上分组 `contextPath` 的问题；调试地址候选会先提供网关上下文地址，再回退到 operation、path 和文档级 `servers`（PR #476）。
- 稳定调试页枚举参数清空后的表格布局，避免清空按钮和输入区挤压错位（PR #498）。
- 调试响应面板补充 SSE 事件时间展示，并在 OpenAPI3 demo 中新增流式响应示例，便于验证事件流调试体验（PR #501）。
- 接入 `enableFilterMultipartApis`、`enableFilterMultipartApiMethodType` 与 `enableDocumentManage` 等后端注入设置，React UI 会按服务端配置过滤多方法接口并展示文档管理开关默认值（PR #502、#503）。
- 顶栏标题优先使用当前 OpenAPI 文档标题，避免固定品牌文案遮住实际文档身份（PR #506）。
- 请求体字段必填标记支持按 `x-validation-groups` 校验分组结果展示，并补充后端扩展字段输出测试（PR #507）。

**后端 & 文档**

- `knife4j-demo-openapi3` 升级到 Spring Boot 4，文档中的 demo 说明同步更新为 Boot4 + React UI 示例（PR #508）。
- GitHub Actions 升级到 Node 24 运行时，issue 表单改为结构化模板，降低后续发布和任务收集噪音（PR #495、#500）。

### 5.0.13

`5.0.13` 是基于 `5.0.12` 的补丁版本，重点修复 React UI 在请求示例、调试默认值、自定义 Footer 与多行描述展示上的细节问题，并修正 `@ApiSupport` 全局扫描包排序。

**前端（React UI）**

- 修复 OAS3 请求示例中的显式值展示：`example` / `examples` 中的空字符串、`false`、`0` 等有效值会被保留，不再被 schema 默认值或占位值覆盖（PR #484）。
- 调试页默认请求数据优先使用 OpenAPI 示例值，并按参数、request body 和媒体类型生成更贴近文档声明的初始调试内容（PR #485）。
- 调整响应字段说明布局，降低说明文本过长时与后续字段重叠的风险（PR #487）。
- 修复自定义 Footer 配置优先级，服务端注入的 `enableFooterCustom`、`footerCustomContent` 与本地设置的覆盖关系保持一致（PR #491）。
- 描述信息支持换行展示，接口详情、模型字段、首页分组说明、调试页参数说明等位置会保留 Markdown 或普通文本中的换行语义（PR #492）。

**后端 & 文档**

- 修复 `@ApiSupport` 全局 `order` 在 packages-to-scan 场景下未稳定参与排序的问题，并补充配置文档和 Boot4 smoke 断言（PR #486）。

### 5.0.12

`5.0.12` 是基于 `5.0.11` 的补丁版本，重点修复 React UI 在语言切换、深层响应字段、组合 schema 分支展示和数据模型默认展开策略上的使用体验问题。

**前端（React UI）**

- 接口文档请求会根据用户显式选择的语言构造 `Accept-Language`，右上角切换语言后会重新请求当前分组的 `api-docs`；未显式选择语言时继续保持浏览器默认请求行为（PR #474）。
- 优化深层响应字段表格布局：字段名列会按 schema 树深度动态加宽，窄容器下提供横向滚动，并支持拖拽调整字段名、类型、必填和说明列宽（PR #473）。
- 修复 `oneOf` / `anyOf` 字段树只展示第一个可解析分支的问题，模型字段页现在会生成 `oneOf[1]`、`oneOf[2]` 等分支节点，并保留分支 `$ref` 类型名与子字段（PR #471）。
- 数据模型页在没有 `schemaName` 路由参数时默认全部折叠，避免大文档一次性展开所有模型；从侧边栏或深链接进入具体模型时仍会自动展开并滚动到目标模型（PR #478）。

### 5.0.11

`5.0.11` 是基于 `5.0.10` 的补丁版本，重点补强 React UI 对 OpenAPI 3.2 文档信息、调试请求服务地址和文件上传场景的支持，并修复首页分组概览统计与 OpenAPI3 starter 传递依赖安全基线。

**前端（React UI）**

- 首页文档信息区支持展示 OpenAPI 3.2 的 `info.summary`、server 名称/描述、许可证标识，以及 `info` / `contact` / `license` 中的标量 `x-*` 扩展字段（PR #456）。
- 调试页 Base URL 输入支持从 OpenAPI `servers` 候选地址中选择，按 operation、path、document 顺序归一化并去重；未配置时保留原默认地址和手工输入能力（PR #454）。
- 修复后端未显式声明 `multipart/form-data`、但 request body schema 中存在 `format: binary` 文件字段时，调试页错误显示 JSON 编辑器的问题；`format: base64` 字符串保持原有 JSON 行为（PR #461）。
- 修复首页“分组概览”统计口径，只展示和统计包含接口的分组，避免顶层空 tag 与 operation 业务 tag 同时出现时被算成两套分组（PR #462）。

**后端 & 依赖管理**

- OpenAPI3 Boot 2.x、Boot 3.x Jakarta、WebFlux 与 Jakarta 聚合 starter 显式管理 `org.apache.commons:commons-lang3` 为 `3.20.0`，并在文档中说明 Spring Boot parent/BOM 仍可能覆盖传递版本，需要应用侧按依赖树结果显式管理（PR #463）。

### 5.0.10

`5.0.10` 是基于 `5.0.9` 的补丁版本，重点修复 Gateway 聚合场景下刷新非默认文档分组深链时的分组恢复问题，并补强 Boot4 + Kotlin DTO 与异常 `api-docs` 响应的兼容性。

**前端（React UI）**

- 修复 Gateway 聚合场景下刷新非默认文档分组深链时仍激活第一个 group，进而显示“未找到接口文档”的问题；React UI 初始化和 URL 变化时会优先恢复 URL 中匹配到的文档分组（PR #446）。
- 优化异常 `api-docs` 响应提示：对缺失或不完整 `info` 的 OpenAPI/Swagger 文档补充最小标题和版本，避免首页、导出等路径崩溃；对非文档 JSON、字符串响应和 Base64 编码的文档响应展示明确诊断信息（PR #448）。

**后端 & 兼容性**

- 修复 Boot4 + Kotlin DTO 中 `val isEnabled: Boolean` 被 OpenAPI schema 写成 `enabled` 的命名偏差；只针对 handler 中使用到的 Kotlin DTO 修正 `isXxx` boolean 字段，并保留显式 `@JsonProperty` / `@JsonGetter` 命名，不向 starter 引入 Kotlin 运行时依赖（PR #447）。

### 5.0.9

`5.0.9` 是基于 `5.0.8` 的补丁版本，重点补齐 React UI 对 Knife4j 后端注入设置的读取能力，覆盖请求参数缓存、自定义 Footer、自定义首页 Markdown 与接口作者展示。

**前端（React UI）**

- 调试页接入后端注入的 `enableRequestCache` 默认值；当服务端关闭请求参数缓存时，React UI 会默认禁用对应缓存行为，仍允许用户在本地设置面板中覆盖（PR #431）。
- 接入 `enableFooterCustom` 与 `footerCustomContent`，React UI 可按后端配置渲染自定义 Footer Markdown；未启用自定义内容时继续使用默认 Footer（PR #437）。
- 接入 `enableHomeCustom` 与 `homeCustomLocation`，React 首页可展示后端注入的自定义 Markdown 内容；`homeCustomPath` 仍由后端读取，不作为前端文件读取入口（PR #435）。
- ApiDoc 接口详情页展示 operation 级 `x-author` 作者信息，用于承接 `@ApiOperationSupport.author/authors` 与类级 `@ApiSupport.author/authors` 合并后的后端扩展字段（PR #436）。

**后端 & 验证**

- Boot 3 Jakarta smoke 覆盖补充接口作者断言，验证后端能把接口作者信息写入 OpenAPI 扩展并供 React UI 消费（PR #439）。

**文档**

- 同步更新配置参考、FAQ、路线图与首页说明，让 React UI 已覆盖的请求缓存、自定义 Footer、自定义首页与作者展示能力在文档中保持一致（PR #431、#435、#436、#437）。

### 5.0.8

`5.0.8` 是基于 `5.0.7` 的补丁版本，重点修复 Jakarta 独立聚合在 cloud 路由缺少 `servicePath` 时的 `swagger-config` 500 问题，并补齐 Gateway、WebFlux 与独立聚合场景的 smoke 验证覆盖。

**后端 & 聚合**

- 修复 `knife4j-aggregation-jakarta-spring-boot-starter` 在 cloud 模式下路由缺少 `servicePath` 时 `/v3/api-docs/swagger-config` 返回 500 的问题，避免单个不完整 route 影响聚合配置生成（PR #423）。
- 新增 Boot 3 Gateway smoke 覆盖，验证 Gateway 场景下 `/doc.html` 与 `/v3/api-docs/swagger-config` 的基础可用性（PR #418）。
- 补齐 Boot 2 独立聚合与 Boot 3 Jakarta 独立聚合 smoke 覆盖，并把对应模块纳入 Java smoke evidence gate 与 CI summary（PR #425、#427）。
- 新增 Boot 2 / Boot 3 WebFlux starter smoke 覆盖，验证 WebFlux 纯依赖编排场景下 `/doc.html` 与 `/v3/api-docs` 可用（PR #426）。

**前端（React UI）**

- React UI 支持按 Knife4j 扩展字段 `x-order` 排序 tag 与 operation；当文档中存在有效 `x-order` 时优先使用扩展排序，缺失时继续回退到既有 sorter 策略（PR #416）。

**文档 & 流程**

- 整理 README 信息结构并补充 Star History 曲线，降低新用户判断项目状态和接入路径的成本（PR #411、#412）。
- 增加 Codex 现场协作手册与 workflow 快照，移除冗余 PR 合并通知 workflow，让 agent 维护流程继续收敛在 issue / PR / CI 状态上（PR #419、#420）。

### 5.0.7

`5.0.7` 是基于 `5.0.6` 的补丁版本，重点修复 Jakarta Swagger BOM 版本管理问题，并继续收口 Vue3 / OAS2 兼容前端的构建验证、运行时输出与 Markdown 预览产物体积。

**后端 & 依赖管理**

- 统一 Jakarta Swagger v3 运行期依赖管理：`swagger-annotations-jakarta`、`swagger-models-jakarta`、`swagger-core-jakarta` 均由 BOM 管理为 `2.2.47`，避免下游导入 `knife4j-dependencies` 后把 springdoc 需要的 Swagger v3 依赖降级，并触发 `Schema.$dynamicRef()` 的 `NoSuchMethodError`（PR #401）。

**前端（Vue3 / OAS2 UI）**

- 新增 `./scripts/test-vue3.sh`，提供 Vue3 / OAS2 UI 独立构建验证入口，并断言 `dist/doc.html`、`dist/webjars/`、`dist/webjars/oauth/oauth2.html` 存在；`knife4j-vue3/README.md` 同步收敛推荐验证命令（PR #406）。
- 清理 Vue3 运行时无业务意义的 `console.log` 调试输出；`ContextMenu` 在组件卸载时移除全局事件监听，避免生命周期外残留监听（PR #407）。
- 将只读 Markdown 预览从完整 `editormd.css` 收敛到轻量 `markdown-preview.css`，避免旧 FontAwesome / editormd 字体资源进入构建产物；同时将 `OtherMarkdown`、设置页、接口页和 Markdown 预览入口改为异步加载，降低首屏静态包体积（PR #408）。

### 5.0.6

`5.0.6` 是基于 `5.0.5` 的补丁版本，重点修复 React 调试页在接口标签切换后的状态保持问题，并收口 GitHub Release 正文生成逻辑。

**前端（React UI）**

- 修复接口标签切换后子页状态丢失的问题：某个接口进入 `debug` 后切到其他接口，再切回原接口时会继续停留在 `debug`，不会退回文档页（PR #396）。
- 调试页按接口维度保留上次请求的响应结果、错误信息、构造请求与 SSE 事件展示；切换接口标签后再回来，仍能看到前一次调试结果（PR #396）。

**发布流程**

- GitHub Release 正文不再由 workflow 额外追加 `Links` 区块，后续 Release body 直接来自 `docs-site/release-notes/index.md` 的对应版本小节，避免发布说明与文档站内容漂移（PR #394）。

### 5.0.5

`5.0.5` 是基于 `5.0.4` 的补丁版本，重点发布 Boot4 Gateway 聚合 starter，修复 Gateway 在 Spring 7 下的请求头兼容问题，并补齐 React 调试页请求参数缓存。

**后端 & Gateway**

- 新增 `knife4j-gateway-boot4-spring-boot-starter`，面向 Spring Boot 4.x + Spring Cloud Gateway 5.x 聚合场景，使用 `spring-cloud-starter-gateway-server-webflux`，复用现有 Gateway 聚合能力并降低对 Boot 3.x 用户的影响（PR #390）。
- 新增 `knife4j-smoke-tests/boot4-gateway-app`，验证 Boot4 Gateway 下 `/doc.html` 与 `/v3/api-docs/swagger-config` 可用；Java smoke evidence gate 与 CI summary 已纳入该模块（PR #390）。
- 修复 Gateway 读取 `Referer` 时依赖 Spring 7 已移除签名的问题，改用 `HttpHeaders.getFirst(HttpHeaders.REFERER)`，避免 Boot4 Gateway 场景出现 `NoSuchMethodError`（PR #388）。

**前端（React UI）**

- 调试页接入已有的 `enableRequestCache` 开关，按接口维度恢复上次填写的 path、query、header、cookie、body 与自定义参数；`重置` 会清理当前接口缓存（PR #389）。
- 请求体 content-type 变化时不再套用旧 body / form 字段，避免切换接口后沿用不匹配的缓存内容（PR #389）。

**发布流程 & 文档**

- 修复 GitHub Release 正文校验的换行误报：读取 Release body 时改用 `gh release view --template` 原文输出，保留严格 diff，但不再被 `--jq .body` 追加的末尾换行干扰（PR #385）。
- 发布模块清单补充 `knife4j-gateway-boot4-spring-boot-starter`，并同步 README、文档站模块说明、兼容矩阵与 Gateway 接入文档（PR #390）。

### 5.0.4

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
    <version>5.3.3</version>
</dependency>
```

详见 [版本参考](/reference/version-ref) 和 [迁移指引](/guide/migration)。
