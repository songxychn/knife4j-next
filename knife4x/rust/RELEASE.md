# Knife4x Go / Rust 同版发布

Rust crate 名为 `knife4x`，使用 crates.io。每次双端发布从同一个已合入 `master` 的提交产生，一个 UI 构建同时进入 Go module 和 Rust crate。Go 沿用 `knife4x/go/vX.Y.Z` annotated tag；根级 `vX.Y.Z` 留给 Java。产品决策见 [#524](https://github.com/songxychn/knife4j-next/issues/524)。

## 准备候选

1. 在发布准备 PR 中确定版本，使 `knife4x/rust/Cargo.toml`、Cargo lockfile、Go 安装命令和双端版本记录一致。更新源码接入说明为正式安装命令，例如 `cargo add knife4x@X.Y.Z --features axum`。
2. 在干净的候选提交运行 `tools/sync-knife4x-ui.sh --check`、`tools/test-knife4x-rust.sh`，以及 [Go 发布前门禁](../go/RELEASE.md#发布前门禁)。Rust 门禁用打包后的 crate 编译独立消费者。核对 `cargo package --manifest-path knife4x/rust/Cargo.toml --list` 含许可证、入口、Worker 和分块资源。
3. 维护者确定发布后，从已验证的提交执行发布操作。下文以 `X.Y.Z` 表示正式版本。

## 首次发布

在 crates.io 确认包名可用，使用已验证邮箱的维护者账号取得有权首次发布该包的短期凭据，通过 Cargo 凭据存储登录。运行：

```bash
cargo publish --locked --dry-run --manifest-path knife4x/rust/Cargo.toml
cargo publish --locked --manifest-path knife4x/rust/Cargo.toml
```

确认公开包可消费，再按 [Go 手册](../go/RELEASE.md) 从同一提交推送 `knife4x/go/vX.Y.Z`。在 crates.io 的 crate 设置中，为后续版本配置 Trusted Publishing，绑定 GitHub 仓库 `songxychn/knife4j-next`、工作流文件 `knife4x-rust-release.yml`、GitHub environment `crates-io`。在 GitHub 将该 environment 的部署 ref 限于 Knife4x 发布 tag。首发凭据用完可撤销；后续工作流使用 OIDC 短期凭据。参见 [crates.io 官方说明](https://blog.rust-lang.org/2025/07/11/crates-io-development-update-2025-07/)。

## 后续版本

从通过候选检查的提交推送 Go annotated tag，再针对该 tag 手动启动 Rust 工作流：

```bash
gh workflow run knife4x-rust-release.yml --ref knife4x/go/vX.Y.Z
```

工作流核对 tag 指向已合入 master 的提交、Cargo 版本和 UI 一致性，完成 Rust 打包验收，再发布到 crates.io。已存在的版本直接进入公共消费验证。

## 完成条件与恢复

在干净的 tag checkout 执行 `tools/test-knife4x-rust.sh --registry X.Y.Z`，验证实际下载的 crate 的来源提交、嵌入资源和 Axum 示例。同时完成 [Go 公共消费验证](../go/RELEASE.md#发布后公共消费验证)，含公共代理来源、checksum 和独立 consumer。两端通过后记录发布结果。

单端成功时保留其制品，从原提交补齐另一端。Cargo 命令若在上传后等待索引超时，先查既有版本及来源，再决定是否重试；已发布版本内容有误时通过新的补丁版本修正。
