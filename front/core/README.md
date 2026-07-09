# knife4j-core

`knife4j-core` 是 `knife4j-ui-react` 使用的 TypeScript 共享能力包。

## 当前职责

- 构造调试请求、校验必填参数并生成 curl。
- 解析 `$ref`、生成 schema 示例和字段树。
- 生成单接口 Markdown 文档。
- 保留少量 Swagger 2 类型定义，用于兼容历史数据结构和测试。

## 目录

```properties
src/
├── debug/          # 调试请求、示例和 schema 纯函数
├── markdownExport.ts
├── models/
│   ├── openapi3/   # OpenAPI 3 模型和解析器
│   └── swagger2/   # Swagger 2 历史类型定义
└── utils/          # 通用工具
```
