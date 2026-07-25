# knife4x / go

Go module：`github.com/songxychn/knife4j-next/knife4x/go`。

核心只依赖标准库 `net/http`。`NewHandler` 接收 `SpecURL` 与可选的 `BasePath`，默认在 `/doc.html`
提供嵌入式 OpenAPI 3 控制台；未命中的请求原样交给宿主 Handler。

## UI 资产

`internal/ui/static/` 是 `front/core` 与 `front/ui-react` 的生成快照，禁止手工修改。唯一更新方式：

```bash
./tools/sync-knife4x-ui.sh
```

检查已提交资产是否与当前前端源码和 `front/bun.lock` 一致：

```bash
./tools/sync-knife4x-ui.sh --check
```

`static/index.html` 是 Vite 构建入口。Handler 将它暴露为 `/doc.html`；`BasePath` 只表示挂载前缀，例如
`BasePath=/internal` 对应 `/internal/doc.html`。

## 验证

```bash
./tools/test-knife4x-go.sh
```
