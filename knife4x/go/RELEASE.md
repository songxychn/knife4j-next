# Knife4x Go 发布

本文冻结 Knife4x Go 的版本、tag 与验收步骤。实际创建或推送 tag 必须由维护者明确授权。

## 固定坐标

| 项 | 值 |
|---|---|
| Go module | `github.com/songxychn/knife4j-next/knife4x/go` |
| 首个版本 | `v0.1.0` |
| 当前版本 | `v0.2.0` |
| 当前 tag | `knife4x/go/v0.2.0` |
| 许可证 | Apache-2.0 |

Go module 位于仓库子目录，因此按
[Go Modules Reference](https://go.dev/ref/mod#mapping-versions-to-commits)，tag 必须带
`knife4x/go/` 前缀。Knife4x 版本独立于 Java `5.x`；现有 Java Release 与 Demo
workflow 的自动 tag 触发器只接收根级 `v*` tag，不接收 `knife4x/go/v*`。
`./tools/test-knife4x-go.sh` 会以无副作用断言保护这条边界。

## 发布前门禁

在干净 checkout 的仓库根目录执行。候选提交必须已经合入 `master`：

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

`test-knife4x-go.sh` 同时覆盖 Go 格式、`go vet`、核心测试、Gin 根路径/子路径冒烟和
Java tag 路由隔离。再检查将进入 module 下载包的许可证与 UI 资产：

```bash
test -f knife4x/go/LICENSE
test -f knife4x/go/internal/ui/static/index.html
test -f knife4x/go/internal/ui/static/assets/index.js
test -f knife4x/go/internal/ui/static/assets/index.css
```

最后核对用户入口与迁移文档：

```bash
grep -Fq 'github.com/songxychn/knife4j-next/knife4x/go' knife4x/README.md
grep -Fq 'knife4x/go/v0.2.0' knife4x/README.md knife4x/go/README.md
grep -Fq 'go@v0.2.0' knife4x/go/MIGRATING_FROM_GIN_SWAGGER.md
grep -Fq 'OAS2 不能直接迁移' knife4x/go/MIGRATING_FROM_GIN_SWAGGER.md
test -z "$(git status --porcelain)"
```

## 创建 tag

以下命令不属于 ready-to-tag 工作项。只有维护者明确授权发布后才执行：

```bash
git tag -a knife4x/go/v0.2.0 -m "Knife4x Go v0.2.0"
git push origin knife4x/go/v0.2.0
```

不要同时创建根级 `v0.2.0` tag，不要运行 Java Maven Release，不要为本次发布新增
registry、OIDC、secret 或 GitHub Release。

## 发布后公共消费验证

先直接查询公共 Go proxy；这里不使用 `direct` fallback：

```bash
module=github.com/songxychn/knife4j-next/knife4x/go
version=v0.2.0
curl -fsS "https://proxy.golang.org/${module}/@v/${version}.info"
```

再用全新 consumer 下载、编译并挂载 Handler。`GONOPROXY=none` 强制该公开 module
仍通过公共 proxy 下载；临时 `GOMODCACHE` 避免复用本机缓存：

```bash
consumer_dir="$(mktemp -d)"
trap 'rm -rf "$consumer_dir"' EXIT

module=github.com/songxychn/knife4j-next/knife4x/go
version=v0.2.0
export GOPROXY=https://proxy.golang.org
export GONOPROXY=none
export GOMODCACHE="$consumer_dir/modcache"

cd "$consumer_dir"
go mod init example.com/knife4x-consumer
go get "$module@$version"

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

if grep -Eq '^[[:space:]]*replace([[:space:](])' go.mod; then
	echo "consumer go.mod must not contain replace" >&2
	exit 1
fi

go build ./...
go list -m all | grep -Fx "$module $version"

module_dir="$(go list -m -f '{{.Dir}}' "$module")"
test -f "$module_dir/LICENSE"
test -f "$module_dir/internal/ui/static/index.html"
test -f "$module_dir/internal/ui/static/assets/index.js"
test -f "$module_dir/internal/ui/static/assets/index.css"
```

只有公共 proxy 查询、无 `replace` consumer 编译和下载内容检查都通过后，才可宣布
Knife4x Go `v0.2.0` 发布完成。

## 补丁原则

- 已发布 tag 不移动、不覆盖；有问题发布新的 patch 版本。
- 只修兼容 bug 时递增 patch；新增向后兼容能力时递增 minor。
- `0.x` 的破坏性变更至少递增 minor，并提供迁移说明。
- Rust 尚未发布，不为本次 Go 版本创建空 crate 或同步 tag。
