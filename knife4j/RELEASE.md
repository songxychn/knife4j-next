# Release

本 fork 通过 GitHub Actions 和 Central Portal Publishing Plugin 发布 Maven Central 构件，并在同一个 Release workflow 中创建 GitHub Release。

## 一次性配置

1. 在 Sonatype Central Portal 注册并验证 `com.baizhukui` namespace。
2. 生成 Central Portal user token。
3. 创建用于构件签名的 GPG key pair。
4. 配置 GitHub repository secrets：

- `CENTRAL_USERNAME`
- `CENTRAL_PASSWORD`
- `GPG_PRIVATE_KEY`
- `GPG_PASSPHRASE`

## CI workflows

- `.github/workflows/build.yml` 在 PR 和 `master` push 时运行 `mvn verify` 等验证。
- `.github/workflows/release.yml` 在推送 `v*` tag 时发布 Maven Central 构件，并创建 GitHub Release。

## Release flow

1. 确认 `knife4j/pom.xml` 和所有子模块版本正确。
2. 在 `docs-site/release-notes/index.md` 增加对应版本小节，例如 `### 5.0.3`。
3. 提交并合并 release prep PR，等待 PR CI 和 `master` push CI 通过。
4. 创建并推送 tag，例如 `v5.0.3`。
5. 等待 GitHub Actions `Release` workflow 完成发布。
6. 等待 `Build and Deploy Demo` workflow 完成 demo 镜像发布。
7. 验收发布完成条件：
   - `vX.Y.Z` tag 已推送。
   - `Release` workflow 成功。
   - `Build and Deploy Demo` workflow 成功。
   - Maven Central 目标构件可访问。
   - GitHub Release `vX.Y.Z` 存在。
   - GitHub Release body 与 `docs-site/release-notes/index.md` 中对应版本小节一致。

## GitHub Release 内容来源

GitHub Release body 由 `.github/workflows/release.yml` 调用 `scripts/extract-release-note.sh` 从 `docs-site/release-notes/index.md` 自动抽取。

如果 release note 中没有当前 tag 对应的小节，Release workflow 必须失败，不允许发布一个没有 GitHub Release 说明的版本。
