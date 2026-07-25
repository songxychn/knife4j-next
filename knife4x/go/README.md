# knife4x / go

未来提供 Go module，将 `front/ui-react` 构建产物嵌入 Go Handler。

## UI 资产

`internal/ui/static/` 是 `front/core` 与 `front/ui-react` 的生成快照，禁止手工修改。唯一更新方式：

```bash
./tools/sync-knife4x-ui.sh
```

检查已提交资产是否与当前前端源码和 `front/bun.lock` 一致：

```bash
./tools/sync-knife4x-ui.sh --check
```

`static/index.html` 是 Vite 构建入口。后续 Handler 默认将它暴露为 `/doc.html`；`BasePath` 只表示挂载前缀，例如
`BasePath=/internal` 对应 `/internal/doc.html`。
