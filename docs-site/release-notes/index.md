---
title: 发布说明
---

# 发布说明

本页记录 knife4j-next 所有版本的变更。

> 判断"值不值得升"？对照 [兼容矩阵](/reference/compatibility) 和 [迁移指引](/guide/migration)。

---

## knife4j-next 版本

### 5.0.1 <Badge type="tip" text="最新" />

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
    <version>5.0.1</version>
</dependency>
```

详见 [版本参考](/reference/version-ref) 和 [迁移指引](/guide/migration)。
