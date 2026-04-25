---
title: 路线图
---

# 路线图

这份路线图不是长期愿景海报，而是围绕最现实的目标排优先级：先成为一个能被社区信任的维护分支，再逐步变成真正的新主线。

---

## 当前阶段：稳定维护 + React 前端对齐

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
| React 前端 | ApiDoc 接口文档展示（参数表格 + 响应结构） | ✅ |
| React 前端 | ApiDebug 接口调试（表单填参 + 发请求 + 响应展示） | ✅ |
| React 前端 | SwaggerModels 数据模型展示 | ✅ |
| React 前端 | Authorize 鉴权配置（Bearer / Basic） | ✅ |
| React 前端 | GlobalParam 全局参数 | ✅ |
| React 前端 | Home 首页统计概览 | ✅ |
| React 前端 | 离线文档导出（HTML / Word） | ✅ |
| React 前端 | 真实 API 数据对接（/v3/api-docs） | ✅ |
| React 前端 | 集成到 `knife4j-openapi3-ui` webjar | ✅ |

### 进行中 🔧

| 领域 | 里程碑 | 关联任务 | 说明 |
| --- | --- | --- | --- |
| React 前端 | 调试层抽取到 knife4j-core | TASK-032 | 纯 TS 解析层，无框架依赖 |
| React 前端 | 按参数定义渲染填参表单 | TASK-026 | 依赖 TASK-032 |

---

## React UI 对齐 Vue2 功能缺口清单

以下表格对比 Vue2 前端（`knife4j-vue`）与 React 前端（`knife4j-ui-react`）的功能覆盖。⬜ = 未实现，🔲 = 部分实现，✅ = 已实现。

### 核心功能

| 功能 | Vue2 | React | 缺口说明 |
| --- | --- | --- | --- |
| 接口文档展示 | ✅ | ✅ | — |
| 接口调试（基础） | ✅ | 🔲 | React 仅支持简化输入，缺少按 OpenAPI 参数定义渲染表单 |
| 数据模型展示 | ✅ | ✅ | — |
| 分组切换 | ✅ | ✅ | — |
| 接口搜索 | ✅ | ✅ | — |
| Authorize 鉴权 | ✅ | 🔲 | React 支持 Bearer/Basic，但不按 securitySchemes 动态渲染 |
| 全局参数 | ✅ | ✅ | — |
| 离线文档导出 | ✅ | ✅ | — |
| 首页统计 | ✅ | ✅ | — |

### 调试页详细缺口

| 功能 | Vue2 | React | 缺口说明 |
| --- | --- | --- | --- |
| 按参数定义渲染 path/query/header/cookie 表单 | ✅ | ⬜ | TASK-026 |
| requestBody 多 Content-Type 切换 | ✅ | ⬜ | TASK-027 |
| application/x-www-form-urlencoded 表单 | ✅ | ⬜ | TASK-027 |
| multipart/form-data 文件上传 | ✅ | ⬜ | TASK-027 |
| raw 模式（Text/JSON/XML 等） | ✅ | ⬜ | TASK-027 |
| 发送前 required 校验 | ✅ | ⬜ | TASK-028 |
| 请求预览（最终 URL/headers/body） | ✅ | ⬜ | TASK-028 |
| 复制 curl 命令 | ✅ | ⬜ | TASK-028 |
| 响应面板 Content/Raw/Headers/Curl Tab | ✅ | ⬜ | TASK-029 |
| JSON 响应格式化 + 复制 | ✅ | 🔲 | React 仅展示原始 JSON，缺少格式化和复制 |
| 二进制响应处理（图片预览/下载） | ✅ | ⬜ | TASK-029 |
| 鉴权与全局参数自动合并 | ✅ | ⬜ | TASK-031 |
| OAuth2 password/client_credentials | ✅ | ⬜ | TASK-033 |

### 增强功能

| 功能 | Vue2 | React | 缺口说明 |
| --- | --- | --- | --- |
| `@ApiSupport.order` Tag 排序 | ✅ | ⬜ | 后端已生效，UI 不排序 |
| `@ApiSupport.author/authors` 展示 | ✅ | ⬜ | 后端已写入 spec，UI 不展示 |
| `@ApiOperationSupport.order` 操作排序 | ✅ | ⬜ | 后端已生效，UI 不排序 |
| `@ApiOperationSupport.author/authors` 展示 | ✅ | ⬜ | 后端已写入 spec，UI 不展示 |
| 设置面板（Header 右上角整合） | ✅ | ⬜ | TASK-024 |
| i18n 中英文切换 | ✅ | ⬜ | TASK-025 |
| 自定义 Markdown 文档 | ✅ | ⬜ | 依赖 UI 设置面板 |
| 全局搜索（跨分组） | ✅ | 🔲 | React 仅搜索当前分组 |
| TypeScript 代码生成 | ✅ | ⬜ | — |

### knife4j-core 抽取

| 模块 | 状态 | 说明 |
| --- | --- | --- |
| `resolveRef(ref, doc)` | ⬜ | 统一 OAS2/OAS3 $ref 解析 |
| `OperationDebugModel` | ⬜ | 从 operation 解析参数模型 |
| `requestBuilder` | ⬜ | 统一请求构造 + curl 输出 |
| `buildSchemaExample` | ⬜ | schema 示例生成（TASK-030） |
| `buildSchemaFieldTree` | ⬜ | schema 字段树（TASK-030） |

---

## 优先级排序原则

1. **稳定性优先**：Bug 修复和兼容性回归永远优先于新功能
2. **调试能力对齐**：Vue2 能做的调试流程，React 也必须能做
3. **核心层先行**：knife4j-core 抽取完成后，UI 层改动才可控
4. **小步快跑**：一个 PR 只做一件事，可独立验证和回滚
5. **不破坏现有体验**：任何改动不能让 `doc.html` 用户降级

---

## 暂时不要做的事

- 不要同时重构后端、前端、文档和品牌
- 不要假设所有历史文档都要立刻迁完
- 不要把实验性的 UI 线写成当前默认实现
- 不要为了代码优雅牺牲向后兼容
- 不要一次性迁移到 React（Vue2 前端仍然可用）

---

## 下一步

1. **完成 TASK-032**：抽取调试/解析层到 knife4j-core
2. **完成 TASK-026 ~ TASK-031**：React 调试页对齐 Vue2 能力
3. **完成 TASK-023 review**：React 前端集成到 starter
4. **补齐 i18n**（TASK-025）
5. **补齐设置面板**（TASK-024）
6. **评估 knife4j-core 的 OAS2/OAS3 统一解析层**（TASK-030）

如果你想参与某个任务的实现，欢迎提 Issue 或 PR。详见 [GitHub 仓库](https://github.com/songxychn/knife4j-next)。
