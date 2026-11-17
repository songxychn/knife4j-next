# Knife4x Go 发布

本文冻结 Knife4x Go 的版本、tag 与验收步骤。实际创建或推送 tag 必须由维护者明确授权。

## 固定坐标

| 项 | 值 |
|---|---|
| Go module | `github.com/songxychn/knife4j-next/knife4x/go` |
| 首个版本 | `v0.1.0` |
| 当前版本 | `v0.10.0` |
| 发布 tag | `knife4x/go/v0.10.0` |
| 许可证 | Apache-2.0 |

Go module 位于仓库子目录，因此按
[Go Modules Reference](https://go.dev/ref/mod#mapping-versions-to-commits)，tag 必须带
`knife4x/go/` 前缀。Knife4x 版本独立于 Java `5.x`；现有 Java Release
workflow 的自动 tag 触发器只接收根级 `v*` tag，不接收 `knife4x/go/v*`；Demo
由 Java Release 完成公开制品核验后调用，不由 Go tag 触发。
`./tools/test-knife4x-go.sh` 会以无副作用断言保护这条边界。

## v0.10.0 发布范围

相较于 `v0.9.2`，新增 Go 宿主的文档访问保护、多分组与 UI 配置（PR [#1053](https://github.com/songxychn/knife4j-next/pull/1053)）：

- `BasicAuth` 保护 UI 与配置中的本地 spec 路径；远端 spec 仍由目标服务负责鉴权和 CORS，业务 API 鉴权保持独立。
- `Disabled` 直接交还宿主 Handler，不验证文档配置或读取 Markdown；宿主必须自行停止注册 spec 路由，才能完整关闭文档。
- `Specs` 提供有序静态分组；`UISettings` 提供低于 spec 扩展和浏览器选择的默认值；`Documents` 提供附加 Markdown 文档。旧单 `SpecURL` / `BasePath` 接法保持兼容。
- 共享 UI 保留加载失败后的分组切换入口，并对齐鉴权路径。完整字段、优先级与保护范围见[配置参考](../../docs/knife4x/configuration.md)及[部署说明](../../docs/knife4x/deployment.md)。

公共库仍只依赖标准库，Go 1.22、Gin 示例 Go 1.26+、module 与 `NewHandler` 签名保持不变。浏览器下限、OpenAPI 3.0/3.1/3.2 JSON 消费、资源授权、预算与取消边界沿用 `v0.9.2`，仍不接受 YAML。部署继续保留同源 Schema Worker、动态分块及既有 CSP 和 JavaScript MIME 配置。源码构建与 UI 同步改用稳定 Bun `1.4.x`（最低 `1.4.4`），直接消费 Go module 无需 JavaScript 运行时。

## 发布前门禁

使用 Go 1.26+ 在干净 checkout 的仓库根目录执行（Gin 示例需要 Go 1.26，公共库仍兼容
Go 1.22）。候选提交必须已经合入 `master`：

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
Java tag 路由隔离。另使用 Go 1.22 执行 `./tools/test-knife4x-go.sh --module core` 验证
公共库最低版本；脚本禁用自动工具链切换，不允许以新版 Go 代替最低版本验证。
再检查将进入 module 下载包的许可证与 UI 资产：

```bash
test -s knife4x/go/LICENSE
test -s knife4x/go/internal/ui/static/index.html
test -s knife4x/go/internal/ui/static/assets/index.js
test -s knife4x/go/internal/ui/static/assets/lib.js
test -s knife4x/go/internal/ui/static/assets/index.css
```

最后核对用户入口与迁移文档：

```bash
grep -Fq 'github.com/songxychn/knife4j-next/knife4x/go' knife4x/README.md
go run tools/check-knife4x-docs.go --root .
test -s docs/knife4x/migration.md
test -z "$(git status --porcelain)"
```

当前示例版本集中在 `docs-version.json`，新增配置的发布边界由
`unreleasedConfigFields` 记录。发布准备时同步该元数据与站内版本标记、安装命令、
配置表和版本记录，不改写历史记录。`exampleCompatibilityVersion` 是最小示例的已发布
兼容基线，独立于本次目标版本；检查器会无 `replace` 下载该基线编译最小示例，其余
示例用本次源码编译，避免发布准备依赖尚未创建的目标 tag。

## 创建 tag

以下命令不属于 ready-to-tag 工作项。只有维护者明确授权发布后才执行：

```bash
git tag -a knife4x/go/v0.10.0 -m "Knife4x Go v0.10.0"
git push origin knife4x/go/v0.10.0
```

不要同时创建根级 `v0.10.0` tag，不要运行 Java Maven Release，不要为本次发布新增
registry、OIDC、secret 或 GitHub Release。

## 发布后公共消费验证

先直接查询公共 Go proxy；这里不使用 `direct` fallback。除版本可用外，还必须确认
proxy 记录的 origin hash 与 annotated tag 指向的 commit 一致，且 ref 是预期的子目录 tag：

```bash
module=github.com/songxychn/knife4j-next/knife4x/go
version=v0.10.0
tag="knife4x/go/${version}"
tag_commit="$(git rev-list -n 1 "$tag")"
proxy_info="$(curl -fsS "https://proxy.golang.org/${module}/@v/${version}.info")"
printf '%s\n' "$proxy_info"

proxy_hash="$(printf '%s' "$proxy_info" | python3 -c 'import json, sys; print(json.load(sys.stdin)["Origin"]["Hash"])')"
proxy_ref="$(printf '%s' "$proxy_info" | python3 -c 'import json, sys; print(json.load(sys.stdin)["Origin"]["Ref"])')"
test "$proxy_hash" = "$tag_commit"
test "$proxy_ref" = "refs/tags/$tag"
```

再查询公开 checksum database，并确认 module 与 `go.mod` 两条 checksum 都存在：

```bash
module=github.com/songxychn/knife4j-next/knife4x/go
version=v0.10.0
sum_response="$(curl -fsS "https://sum.golang.org/lookup/${module}@${version}")"
printf '%s\n' "$sum_response"
printf '%s\n' "$sum_response" | grep -F "${module} ${version} h1:"
printf '%s\n' "$sum_response" | grep -F "${module} ${version}/go.mod h1:"
```

最后用全新 consumer 下载、编译并运行 Handler。`GONOPROXY=none` 强制该公开 module
仍通过公共 proxy 下载；临时 `GOMODCACHE` 避免复用本机缓存：

```bash
consumer_dir="$(mktemp -d)"
trap 'rm -rf "$consumer_dir"' EXIT

module=github.com/songxychn/knife4j-next/knife4x/go
version=v0.10.0
export GOPROXY=https://proxy.golang.org
export GONOPROXY=none
export GOMODCACHE="$consumer_dir/modcache"

cd "$consumer_dir"
go mod init example.com/knife4x-consumer
go get "$module@$version"

cat > main.go <<'EOF'
package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"

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
	for _, path := range []string{"/doc.html", "/assets/index.js", "/assets/lib.js", "/assets/index.css"} {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		if recorder.Code != http.StatusOK || recorder.Body.Len() == 0 {
			panic(fmt.Sprintf("empty or unsuccessful Handler response for %s: %d", path, recorder.Code))
		}
	}
	fmt.Println("knife4x-consumer-ok")
}
EOF

if grep -Eq '^[[:space:]]*replace([[:space:](])' go.mod; then
	echo "consumer go.mod must not contain replace" >&2
	exit 1
fi

go build ./...
go run .
go list -m all | grep -Fx "$module $version"

module_dir="$(go list -m -f '{{.Dir}}' "$module")"
test -s "$module_dir/LICENSE"
test -s "$module_dir/internal/ui/static/index.html"
test -s "$module_dir/internal/ui/static/assets/index.js"
test -s "$module_dir/internal/ui/static/assets/lib.js"
test -s "$module_dir/internal/ui/static/assets/index.css"
```

只有公共 proxy 的 origin hash / ref、`sum.golang.org` checksum、无 `replace` consumer
编译、Handler 运行和下载内容检查都通过后，才可宣布 Knife4x Go `v0.10.0` 发布完成。

## 补丁原则

- 已发布 tag 不移动、不覆盖；有问题发布新的 patch 版本。
- 只修兼容 bug 时递增 patch；新增向后兼容能力时递增 minor。
- `0.x` 的破坏性变更至少递增 minor，并提供迁移说明。
- Rust 尚未发布，不为本次 Go 版本创建空 crate 或同步 tag。
