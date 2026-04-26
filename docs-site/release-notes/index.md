---
title: 发布说明
---

# 发布说明

本页记录 knife4j-next 所有版本的变更。

> 判断"值不值得升"？对照 [兼容矩阵](/reference/compatibility) 和 [迁移指引](/guide/migration)。

---

## knife4j-next 版本

### 1.0.0 <Badge type="tip" text="即将发布" />

**knife4j-next 正式版** — 相比 Preview 版本新增了大量前端功能，是第一个推荐生产试用的版本。

**前端（knife4j-ui-react）**

- 国际化：接入 react-i18next，支持 zh-CN / en-US 双语
- ApiDebug 参数渲染：类型感知输入（enum→Select, boolean→Switch, number→InputNumber, array→TextArea…）
- ApiDebug 请求体：多 content-type 表单支持（JSON / form-data / x-www-form-urlencoded）
- ApiDebug 请求预览：发送前校验 + cURL 预览 Tab
- ApiDebug 响应面板：对齐 Vue2 版本，支持复制 Raw / cURL、下载、响应体大小显示
- ApiDebug 认证 & 全局参数：合并注入请求（来源标签 interface / global / auth）
- Authorize：按 securitySchemes 动态渲染，支持 OAuth2 授权码流程
- ApiDoc 工具栏：复制 endpoint / Markdown / URL
- 侧边栏：接口搜索结果高亮 + HTTP Method 过滤条
- Tab 标签页：右键菜单（关闭当前 / 关闭其他 / 关闭全部）+ 刷新后状态持久化（sessionStorage）
- Home 页：重设计，更丰富的 OpenAPI 概览（接口统计、分组信息、扩展属性）
- OfficeDoc 离线文档：增强 responses 渲染 + schema description 工具函数
- GlobalParam：布局改进
- Settings 设置面板：新增 SettingsContext，整合更多配置项
- Markdown 渲染：API / tag / info description 支持 Markdown 格式
- 品牌标识：knife4j-next logo 替换旧 logo

**前端基础设施**

- knife4j-core：提取 debug 解析层到独立包（82 项单元测试覆盖 OAS2/OAS3 参数解析、路径替换、header 合并等）
- knife4j-core：新增 buildSchemaExample & buildSchemaFieldTree（schema 示例构建器）
- npm workspaces：统一 knife4j-front 包管理，workspace symlink 替代 tgz
- Node.js 22 LTS：CI 和本地开发环境统一升级至 Node 22
- Vite dev proxy：`/api` 转发到 demo 后端，本地开发无需手动配代理
- Prettier + Spotless 格式化规范落地，CI 增加格式检查
- `-parameters` 编译参数：修复 Springdoc 路径参数识别

**Bug 修复**

- 修复 core 层路径参数从 URL 模板兜底提取（处理 Springdoc 未声明的 path param）
- 修复 ApiDebug notFound 闪烁 & 侧边栏 method 标签对齐
- 修复 GlobalParamProvider 需提升到 app root 才能跨页面生效
- 修复 Vite dev server 下品牌 logo 不显示
- 修复 knife4j-demo 需设置 `knife4j-java.version=17`
- 修复 CI npm registry URL 泄露私有源
- 修复 Spotless `indentEmptyLines` 导致空行缩进不一致

---

### 4.6.0.3 <Badge type="warning" text="Preview" />

> Preview 版本：前端首次集成 React UI 到 `knife4j-openapi3-ui` webjar。仅包含基础功能，不推荐生产使用。请升级到 `1.0.0`。

**前端**

- 集成 knife4j-ui-react（React 下一代前端）到 `knife4j-openapi3-ui` webjar
- 新增设置面板（Header 右上角），整合 Authorize / GlobalParam / OfflineDoc 三个 Tab
- 实现离线文档导出（HTML / Word）
- 实现 Home 页、ApiDoc 页、ApiDebug 页、SwaggerModels 页
- 实现 Authorize、GlobalParam 功能页
- 实现侧边栏分组切换与搜索过滤
- 接入真实 API 数据层（OpenAPI 解析）

**其他**

- demo 模块：根路径 `/` 重定向至 `/doc.html`
- demo 模块：接口示例改用 DTO + `@Schema` 注解

---

## 上游 knife4j 版本（com.github.xiaoymin）

> 以下版本来自上游 `xiaoymin/knife4j`，knife4j-next 基于最后的 4.5.0 版本 fork。仅作历史参考。

### 4.5.0（2024-01-08）— 上游最终版本

- 新增日语 i18n 支持（Gitee#PR98）
- 修复 `EnvironmentPostProcessor` 与用户 `defaultProperties` 冲突（Gitee#PR100）
- 修复 `addOrderExtension` NPE（Gitee#PR99）
- **修复 Spring Boot 3 下 `@ApiOperationSupport` 的 `order` 不生效**（核心修复）
- 修复 `springdoc.group-configs.packages-to-scan` 未设置时的 NPE（Gitee#I8O7E8）
- 修复 `@Schema.description` 在实体参数上不渲染（Gitee#I8EVO3, GitHub#690）
- 修复 OpenAPI 3 请求参数 `format` 属性展示异常（Gitee#I8KRWV）
- 修复自定义文档中服务名含连字符时刷新报错（Gitee#I8EKAQ）
- 移除文档 `favicon.ico` 引用（GitHub#716）
- 企业插件扩展点（Orangeforms 低代码平台）

---

## 版本号说明

knife4j-next 从 `1.0.0` 起采用独立 [SemVer](https://semver.org/lang/zh-CN/) 版本号：

```
1.0.0 → knife4j-next 正式版（首个推荐生产试用的版本）
4.6.0.3 → Preview 版本（仅包含基础 React 前端，不推荐生产使用）
```

从 `1.0.0` 起，Maven 坐标为 `com.baizhukui`：
```xml
<dependency>
    <groupId>com.baizhukui</groupId>
    <artifactId>knife4j-openapi3-jakarta-spring-boot-starter</artifactId>
    <version>1.0.0</version>
</dependency>
```

详见 [版本参考](/reference/version-ref) 和 [迁移指引](/guide/migration)。
