# Knife4x

嵌入式 OpenAPI 3 文档 + 调试控制台，面向 **Go / Rust** 宿主（规划中）。

## 定位

- 与 Java 线 **knife4j-next**（`knife4j/` + `doc.html`）同仓、同 UI 演进，**独立版本与发布坐标**
- **不生成** OpenAPI；只消费标准 OpenAPI 3
- UI 源码与 Java webjar **共用** `front/ui-react`（及 `front/core`），本目录只放宿主壳

## 目录（骨架）

```text
knife4x/
  go/          # 未来：Go module（embed UI + Handler）
  rust/        # 未来：Rust crate（embed UI + axum 等）
  examples/    # gin / axum 示例（占位）
```

## 非目标（当前）

- 功能实现与发布（另开 issue / PR）
- 第二份前端工程
- OAS2 支持
- 云托管文档站

需求基线见仓库 issue #524。
