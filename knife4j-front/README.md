# knife4j-front

这是 `knife4j-next` 的前端工作区，当前使用 Bun workspace 管理活跃包。

## 活跃模块

| 模块 | 说明 |
| --- | --- |
| `knife4j-core` | 基于 TypeScript 的 OpenAPI / Swagger 解析核心库，为上层 UI 提供统一数据结构 |
| `knife4j-ui-react` | React + Vite + Ant Design 前端 UI，面向 OpenAPI 3.x，并打包进 `knife4j-openapi3-ui` webjar |

`knife4j-cli`、`knife4j-extension` 和浏览器扩展目录目前属于历史规划或占位内容，尚未纳入 Bun workspace。

## 架构设计

![](../static/knife4j-front-architecture.png)

## knife4j-core

前端核心模块，也是上层应用的基础库，主要负责：

- 解析 OpenAPI 3、Swagger 2、AsyncAPI 等规范
- 解析 Postman、curl 等工具格式
- 提供统一数据结构，供 UI 和后续工具使用
- 为 Knife4j 自身扩展能力提供前端解析支撑

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
