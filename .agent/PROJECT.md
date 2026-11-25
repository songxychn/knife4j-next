# 项目意图

`knife4j-next` 是 `xiaoymin/knife4j` 的社区维护 fork，为仍依赖 `doc.html` 与相关 starter 的用户提供稳定的维护路径。

## 优先级与非目标

- **优先**：保持既有用户稳定可用 → 修复 Spring Boot / Framework 矩阵兼容 → 降低回归风险 → 发布可重复 → 增量演进 OAS3 前端。
- **非目标**：完整产品重写、擅自破坏 `doc.html` 兼容约定、为代码优雅牺牲向后兼容。

## 前端两条线（硬边界）

| 源码 | WebJar | OpenAPI | 策略 |
|---|---|---|---|
| `front/ui-react` | `knife4j-openapi3-ui` | **OAS 3 only** | **主线**：新功能、UX、调试器 |
| `front/vue3` | `knife4j-openapi2-ui` | **OAS 2 only** | **兼容维护**：回归 / 安全 / 显示 bug，不做功能扩张 |

禁止把 `front/vue3` 接 OAS3、给 React UI 擅自加 OAS2 兼容层，或在 `knife4j-openapi2-ui` 引入 React 产物。OAS2 新功能请求标 `wontfix` + `wontfix:oas2-scope`，引导迁 OAS3。

## 仓库区域

| 路径 | 说明 |
|---|---|
| `knife4j/` | Java 多模块主工程（starter、UI webjar、聚合、Gateway、WebFlux、smoke、demo） |
| `front/core`、`front/schema-engine` | OAS3 解析与 JSON Schema 引擎 |
| `front/ui-react` | OAS3 主线 UI |
| `front/vue3` | OAS2 兼容 UI |
| `docs/` | VitePress 文档站 |
| `knife4x/` | Go / Rust 宿主壳（复用 `front/ui-react` 产物，不另建前端） |
| `tools/` | 验证与发布脚本 |

任务优先级以 GitHub Issues + Labels 为准，不维护静态路线图。
