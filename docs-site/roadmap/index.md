---
title: 路线图
---

# 路线图

这份路线图不是长期愿景海报，而是围绕最现实的目标排优先级：先成为一个能被社区信任的维护分支，再逐步变成真正的新主线。

---

## 当前阶段：5.0.0 已发布

### 已完成 ✅

| 领域 | 里程碑 | 状态 |
| --- | --- | --- |
| 基础设施 | Maven `groupId` 迁移至 `com.baizhukui` | ✅ |
| 基础设施 | GitHub Actions CI/CD 流程补齐 | ✅ |
| 安全 | 修复 `/v2/api-docs` 分号绕过 Basic 认证（#886） | ✅ |
| 兼容性 | Spring Boot 3.4.x / 3.5.x 兼容（springdoc 2.8.9） | ✅ |
| Bug 修复 | Gateway `context-path` 导致聚合 host 少斜杠（#954） | ✅ |
| Demo | `knife4j-demo` 模块 + Docker 部署 | ✅ |
| 文档 | VitePress 文档站全面重写 | ✅ |
| React 前端 | 基础架构（路由、侧边栏、分组切换、搜索） | ✅ |
| React 前端 | ApiDoc 接口文档展示（参数表格 + 响应结构 + 复制操作） | ✅ |
| React 前端 | ApiDebug 接口调试（类型感知参数输入 + requestBody 多 content-type + cURL 预览 + 响应复制/下载） | ✅ |
| React 前端 | SwaggerModels 数据模型展示 | ✅ |
| React 前端 | Authorize 鉴权配置（securitySchemes 动态渲染 + OAuth2 授权码流程） | ✅ |
| React 前端 | GlobalParam 全局参数 | ✅ |
| React 前端 | Home 首页统计概览（重设计） | ✅ |
| React 前端 | 离线文档导出（HTML / Word） | ✅ |
| React 前端 | 真实 API 数据对接（/v3/api-docs） | ✅ |
| React 前端 | 集成到 `knife4j-openapi3-ui` webjar | ✅ |
| React 前端 | i18n 中英文切换 | ✅ |
| React 前端 | 设置面板（Header 右上角整合） | ✅ |
| React 前端 | Tab 右键菜单 + 刷新后状态持久化 | ✅ |
| React 前端 | 侧边栏接口搜索高亮 + Method 过滤条 | ✅ |
| React 前端 | Markdown 渲染（API/tag/info description） | ✅ |
| React 前端 | OAuth2 授权码 / 隐式模式弹窗流程 | ✅ |
| React 前端 | 离线文档导出（HTML / Word / Markdown / OpenAPI JSON） | ✅ |
| React 前端 | 尊重后端 tags-sorter / operations-sorter 配置 | ✅ |
| knife4j-core | debug 解析层抽取（resolveRef / OperationDebugModel / requestBuilder） | ✅ |
| knife4j-core | buildSchemaExample & buildSchemaFieldTree | ✅ |
| 基础设施 | npm workspaces 统一 knife4j-front 包管理 | ✅ |
| 基础设施 | Node.js 22 LTS + Prettier + Spotless 格式化规范 | ✅ |

---

## React UI 对齐 Vue3 功能缺口清单

以下表格对比本仓库 `knife4j-vue3`（Vue 3，OAS2 starter 前端）与 `knife4j-ui-react`（React，OAS3 starter 前端）的功能覆盖。⬜ = 未实现，🔲 = 部分实现，✅ = 已实现。

> 注：`knife4j-vue3` 的功能基线与 upstream `knife4j-vue`（Vue 2）基本一致，下面 Vue3 列的状态等同于 upstream Vue2 的功能覆盖。

### 核心功能

| 功能 | Vue3 | React | 缺口说明 |
| --- | --- | --- | --- |
| 接口文档展示 | ✅ | ✅ | — |
| 接口调试 | ✅ | ✅ | — |
| 数据模型展示 | ✅ | ✅ | — |
| 分组切换 | ✅ | ✅ | — |
| 接口搜索 | ✅ | ✅ | — |
| Authorize 鉴权 | ✅ | 🔲 | React 支持 securitySchemes 动态渲染 + OAuth2 授权码/隐式流程，缺少 password/client_credentials |
| 全局参数 | ✅ | ✅ | — |
| 离线文档导出 | ✅ | 🔲 | React 支持 HTML/Word/Markdown/OpenAPI JSON，缺少 Word 模板自定义 |
| 首页统计 | ✅ | ✅ | — |

### 调试页详细缺口

| 功能 | Vue3 | React | 缺口说明 |
| --- | --- | --- | --- |
| multipart/form-data 文件上传 | ✅ | 🔲 | 基础表单可用，完整文件上传待优化 |
| OAuth2 password/client_credentials | ✅ | ⬜ | — |
| afterScript（请求后脚本） | ✅ | ⬜ | — |

### 增强功能

| 功能 | Vue3 | React | 缺口说明 |
| --- | --- | --- | --- |
| `@ApiSupport.order` Tag 排序 | ✅ | ⬜ | 后端已生效，UI 不排序 |
| `@ApiSupport.author/authors` 展示 | ✅ | ⬜ | 后端已写入 spec，UI 不展示 |
| `@ApiOperationSupport.order` 操作排序 | ✅ | ⬜ | 后端已生效，UI 不排序 |
| `@ApiOperationSupport.author/authors` 展示 | ✅ | ⬜ | 后端已写入 spec，UI 不展示 |
| 自定义 Markdown 文档 | ✅ | ⬜ | 依赖 UI 设置面板读取 setting |
| 全局搜索（跨分组） | ✅ | 🔲 | React 仅搜索当前分组 |
| TypeScript 代码生成 | ✅ | ⬜ | — |
| Postman 导出 | ✅ | ⬜ | — |

### knife4j-core 已抽取模块

| 模块 | 状态 | 说明 |
| --- | --- | --- |
| `resolveRef(ref, doc)` | ✅ | 统一 OAS2/OAS3 $ref 解析 |
| `OperationDebugModel` | ✅ | 从 operation 解析参数模型 |
| `requestBuilder` | ✅ | 统一请求构造 + curl 输出 |
| `buildSchemaExample` | ✅ | schema 示例生成 |
| `buildSchemaFieldTree` | ✅ | schema 字段树 |

---

## 优先级排序原则

1. **稳定性优先**：Bug 修复和兼容性回归永远优先于新功能
2. **调试能力对齐**：Vue3（OAS2 starter）能做的调试流程，React 也必须能做
3. **核心层先行**：knife4j-core 抽取完成后，UI 层改动才可控
4. **小步快跑**：一个 PR 只做一件事，可独立验证和回滚
5. **不破坏现有体验**：任何改动不能让 `doc.html` 用户降级

---

## 暂时不要做的事

- 不要同时重构后端、前端、文档和品牌
- 不要假设所有历史文档都要立刻迁完
- 不要把实验性的 UI 线写成当前默认实现
- 不要为了代码优雅牺牲向后兼容
- 不要一次性停掉 OAS2 兼容维护（`knife4j-vue3` 仍然可用）

---

## 下一步

1. **补齐 `knife4j.setting.*` UI 开关联动**：React 前端读取后端注入的 x-knife4j setting
2. **补齐 OAuth2 password / client_credentials** 调试流程
3. **补齐 Postman 导出**
4. **`@ApiSupport.order` / `@ApiOperationSupport.order` 排序**

如果你想参与某个任务的实现，欢迎提 Issue 或 PR。详见 [GitHub 仓库](https://github.com/songxychn/knife4j-next)。
