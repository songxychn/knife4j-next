# 发布说明

## 当前版本

### 4.6.0.3

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

### 4.6.0.2

**Bug 修复**
- 修复 `/v2/api-docs` 路径加分号可绕过 Basic 认证的安全漏洞（#886）
- 修复 gateway `context-path` 配置导致聚合 host 缺少斜杠的问题（#954）

**兼容性**
- 兼容 Spring Boot 3.4.x / 3.5.x（升级 springdoc-openapi-jakarta 至 2.8.9）
- 新增 Boot 3.5.0 smoke 测试模块

**新增**
- 新增 `knife4j-demo` 在线预览模块，支持 Docker 部署
- 新增 KUtils 单元测试覆盖
- 文档站（docs-site）导航修复
- CI 全面迁移至 Node.js 24

---

### 4.6.0.1

- Maven `groupId` 已切到 `com.baizhukui`
- 仓库已经补齐 GitHub Actions 构建与发布流程
- 当前优先处理兼容性、回归问题和发版恢复

---

## 关于这个页面

每个版本修复了哪些兼容性问题、哪些问题仍在处理中，都会在这里持续更新。

如果你想判断"现在这个版本值不值得升"，可以对照 [兼容矩阵](/reference/compatibility) 和 [迁移指引](/guide/migration)。
