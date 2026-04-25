# 发布说明

## 当前版本

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
