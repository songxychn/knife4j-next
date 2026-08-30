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
- `.github/workflows/release.yml` 在推送 `v*` tag 时发布 Maven Central 构件，验证公共仓库精确构件 URL 后创建 GitHub Release；手动触发只提供 `finalize-only` 安全收尾。
- `.github/workflows/deploy-demo.yml` 仅在推送 `v*` tag（或 `workflow_dispatch`）时构建并部署在线 demo，**不在** `master` 合并时自动部署，避免 demo 超前于已发布版本。

## Release flow

1. 确认 `knife4j/pom.xml` 和所有子模块版本正确。
2. 在 `docs/release-notes/index.md` 增加对应版本小节，例如 `### 5.0.8`。
3. 提交并合并 release prep PR，等待 PR CI 和 `master` push CI 通过。
4. 创建并推送 annotated tag，例如 `v5.0.8`。
5. 等待 GitHub Actions `Release` workflow 完成发布。
6. 等待同一次 tag 触发的 `Build and Deploy Demo` workflow 完成 demo 镜像发布。
7. 验收发布完成条件：
   - `vX.Y.Z` tag 已推送。
   - `Release` workflow 成功。
   - `Build and Deploy Demo` workflow 成功（与 tag 对齐，非 master 合并触发）。
   - Maven Central 目标构件可访问。
   - GitHub Release `vX.Y.Z` 存在。
   - GitHub Release body 与 `docs/release-notes/index.md` 中对应版本小节一致。

## GitHub Release 内容来源

GitHub Release body 由 `.github/workflows/release.yml` 调用 `tools/extract-release-note.sh` 从 `docs/release-notes/index.md` 自动抽取。

如果 release note 中没有当前 tag 对应的小节，Release workflow 必须失败，不允许发布一个没有 GitHub Release 说明的版本。

## Central 延迟与 `finalize-only` 恢复

正常发布只由 tag push 触发。Central Publishing Plugin 保留 `autoPublish=true` 与 `waitUntil=published`，最多等待 7200 秒并每 15 秒轮询；GitHub Actions job 的 180 分钟上限为后续公共构件验证预留了余量。

如果 `Publish to Maven Central` 已输出 deployment ID、bundle 上传成功，但等待 Central 发布超时：

1. 保留失败 run 和原 tag，先核对 deployment 状态及精确 POM/JAR URL。Central 目录索引返回 404 不能作为构件缺失结论。
2. **禁止重新运行 `mvn deploy`、移动 tag 或重传同版本构件。** 发布构件不可覆盖，模糊日志也不能视为上传失败。
3. 等公共构件可见后，在 Actions 中手动运行 `Release`，选择唯一的 `finalize-only` mode，并填写已有 annotated `vX.Y.Z` tag。
4. 恢复路径会 checkout 该 tag，校验 tag/POM/发布说明一致，读取 `tools/release-modules.txt` 检查父 POM、各模块 POM/JAR、签名、SHA-1 和 UI JAR，再幂等创建或更新 GitHub Release。

`finalize-only` 不执行 Maven deploy，也不读取 Central/GPG secrets。tag 不存在或不是 annotated tag、checkout/POM 版本不一致、发布说明缺失、公共构件不完整时都会失败关闭；公共仓库超过有界等待时只报告缺失模块，不自动重传。
