# knife4j-front

这是 `knife4j-next` 的前端工作区，当前使用 Bun workspace 管理活跃包。

## 活跃模块

| 模块 | 说明 |
| --- | --- |
| `knife4j-core` | 基于 TypeScript 的 React UI 共享工具包，提供调试、schema 与 Markdown 导出能力 |
| `knife4j-ui-react` | React + Vite + Ant Design 前端 UI，面向 OpenAPI 3.x，并打包进 `knife4j-openapi3-ui` webjar |

## 架构设计

![](../static/knife4j-front-architecture.png)

## knife4j-core

前端核心模块，也是上层应用的基础库，主要负责：

- 为 React UI 提供调试请求构造、schema 展示和 Markdown 导出等共享能力
- 保留少量 Swagger 2 类型定义，用于兼容历史数据结构和测试

## knife4j-ui-react

OpenAPI 3.x 主线 UI，提供文档预览、接口调试、鉴权配置、数据模型、离线导出等核心功能。

## 本地命令

```bash
bun install --frozen-lockfile
bun run --filter knife4j-core test
bun run --filter knife4j-ui-react dev
```

完整前端验证请从仓库根目录运行：

```bash
./scripts/test-front-core.sh
```
