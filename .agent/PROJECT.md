# 项目意图

## 是什么

`knife4j-next` 是 `xiaoymin/knife4j` 的社区维护 fork，为仍依赖 `doc.html` 与相关 starter 的用户提供更可预期的维护路径。

## 优先级

1. 保持现有用户可用、稳定、可预期。
2. 修复 Spring Boot / Spring Framework 矩阵上的兼容问题。
3. 降低聚合、UI 交付与 starter 的回归风险。
4. 发布可重复、少临场操作。
5. 通过 `front` **增量**推进下一代前端，不一次性重写。

## 非目标

- 完整产品重设计。
- 未经批准替换 `doc.html` 兼容约定。
- 一次性迁到 React。
- 为代码优雅牺牲向后兼容。

## 前端两条线（硬边界）

| 源码 | WebJar | OpenAPI | 策略 |
|---|---|---|---|
| `front/ui-react` | `knife4j-openapi3-ui` | **OAS 3 only** | **主线**：新功能、UX、调试器 |
| `front/vue3` | `knife4j-openapi2-ui` | **OAS 2 only** | **兼容维护**：回归 / 安全 / 显示 bug；不做功能扩张 |

处理反馈：

1. OAS3-only → `area:ui-react`
2. OAS2-only → `area:ui-vue3`，只修显示与兼容
3. 两边都有的共性 bug → 优先 OAS3 主线；OAS2 仅最小兼容或接受现状
4. OAS2 **新功能**请求 → `wontfix: scope-policy`，引导迁 OAS3
5. `knife4j-core` 只服务 OAS3，不为 OAS2 扩展

禁止擅自：

- 把 OAS2 starter 切回 upstream Vue 2 webjar
- 让 `front/vue3` 接 OAS3 数据源
- 给 React UI 加 OAS2 兼容层（除非维护者批准）
- 在 `knife4j-openapi2-ui` 引入 React 产物

`front/ui-react` 里残留的 OAS2 类型字段是历史兼容，**不构成 OAS2 功能承诺**；不主动清理也不主动扩展。

## 主要区域

| 路径 | 说明 |
|---|---|
| `knife4j/` | Java 多模块主工程，影响面最大 |
| `front/core` | OAS3 解析核心 |
| `front/ui-react` | OAS3 主线 UI |
| `front/vue3` | OAS2 兼容 UI |
| `docs/` | VitePress 文档站 |
| `knife4x/` | Go/Rust 宿主壳（UI 复用 React 产物，禁止第二份前端） |
| `legacy/` | 冻结历史，不接常规功能任务 |
| `tools/` | 验证 / 发布 / 任务看板脚本 |

## 稳定性优先

多种方案时优先：保留运行时行为 → 加强测试/诊断 → 回滚简单。

## 状态写回

跨会话状态写在 **GitHub Issue / PR**，不要只留在聊天里。

## 工具链

活跃前端统一 **bun**（`front/`、`front/vue3/`、`docs/`）。  
用 `bun install --frozen-lockfile`，不要恢复 `package-lock.json`。
