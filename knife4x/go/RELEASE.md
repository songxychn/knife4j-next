# Knife4x Go 发布指南

本文记录 Knife4x Go 的模块坐标、tag 约定与发版验收步骤。创建或推送 tag 需经维护者明确确认。

## 模块坐标与 Tag 约定

| 项 | 值 |
|---|---|
| Go module | `github.com/songxychn/knife4j-next/knife4x/go` |
| Tag 格式 | `knife4x/go/vX.Y.Z` |
| 许可证 | Apache-2.0 |

Go module 位于仓库子目录，按 [Go Modules Reference](https://go.dev/ref/mod#mapping-versions-to-commits)，tag 必须带 `knife4x/go/` 前缀。Knife4x 版本独立于 Java `5.x`；Java Release 与 Demo workflow 仅触发根级 `v*` tag，不会响应 `knife4x/go/v*`。

## 发布前门禁

在已合并到 `master` 的干净工作区根目录执行：

```bash
git fetch origin master
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/master)"
test -z "$(git status --porcelain)"

(cd knife4x/go && go mod tidy -diff)
(cd knife4x/examples/gin && go mod tidy -diff)

./tools/test-knife4x-go.sh
./tools/sync-knife4x-ui.sh --check
./tools/test-ci-changes.sh
./tools/test-docs.sh
git diff --check
```

确认待打包进入 module 的许可证与 UI 静态资产齐全：

```bash
test -f knife4x/go/LICENSE
test -f knife4x/go/internal/ui/static/index.html
test -f knife4x/go/internal/ui/static/assets/index.js
test -f knife4x/go/internal/ui/static/assets/index.css
```

## 创建并推送 Tag

```bash
VERSION=vX.Y.Z   # 例如 v0.2.4
git tag -a "knife4x/go/${VERSION}" -m "Knife4x Go ${VERSION}"
git push origin "knife4x/go/${VERSION}"
```

注意不要误推根级 `vX.Y.Z` tag（会触发 Java Maven Central 发布）。

## 发布后公共消费验证

1. 查询公共 Go proxy（不使用 `direct` fallback）：

```bash
MODULE=github.com/songxychn/knife4j-next/knife4x/go
VERSION=vX.Y.Z
curl -fsS "https://proxy.golang.org/${MODULE}/@v/${VERSION}.info"
```

2. 在临时目录以全新 consumer 下载、编译并核对 module 内容：

```bash
consumer_dir="$(mktemp -d)"
trap 'rm -rf "$consumer_dir"' EXIT

MODULE=github.com/songxychn/knife4j-next/knife4x/go
VERSION=vX.Y.Z
export GOPROXY=https://proxy.golang.org
export GONOPROXY=none
export GOMODCACHE="$consumer_dir/modcache"

cd "$consumer_dir"
go mod init example.com/knife4x-consumer
go get "${MODULE}@${VERSION}"

cat > main.go <<'EOF'
package main

import (
	"net/http"

	knife4x "github.com/songxychn/knife4j-next/knife4x/go"
)

func main() {
	handler, err := knife4x.NewHandler(
		knife4x.Config{SpecURL: "/openapi.json"},
		http.NewServeMux(),
	)
	if err != nil {
		panic(err)
	}
	_ = &http.Server{Addr: ":8080", Handler: handler}
}
EOF

go build ./...
go list -m all | grep -Fx "${MODULE} ${VERSION}"

module_dir="$(go list -m -f '{{.Dir}}' "$MODULE")"
test -f "$module_dir/LICENSE"
test -f "$module_dir/internal/ui/static/index.html"
test -f "$module_dir/internal/ui/static/assets/index.js"
test -f "$module_dir/internal/ui/static/assets/index.css"
```

## 版本原则

- 已发布 tag 不移动、不覆盖；有问题发布新的 patch 版本。
- 只修兼容 bug 时递增 patch；新增向后兼容能力时递增 minor。
- `0.x` 的破坏性变更至少递增 minor，并提供迁移说明。
