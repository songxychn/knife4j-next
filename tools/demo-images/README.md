# Demo 镜像构建与部署通道

`Publish validated Demo images` 为两个在线 Demo 构建包含当前已合并安全修复的镜像。
它不是 Maven/Release 发布：原 `deploy-demo.yml` 仍只从经过 Central 和 GitHub Release
核验的版本构建 `latest`/版本标签。本通道单独维护 `demo` 标签，不改写 `latest`。

## 发布契约

- 只支持 Linux amd64，OAS2 Java 8、OAS3 Java 17；基础镜像 digest 在 `bases.json`。
- PR 只验证；master 相关路径更新或手工运行 master 时，两个矩阵候选均通过后才允许发布。
- 发布前还要求同一 master SHA 的 `Build` workflow 最新运行成功；master 已前移时拒绝旧提交推广。
- 可执行 JAR 必须唯一，检查内含依赖不低于当前已部署安全修补基线。该检查不等于全量漏洞扫描，
  Boot 2 剩余旧支持线风险继续由 #957 跟踪；依赖主版本变化必须显式更新契约并审查。
- 候选启动使用线上 UID/GID10001、只读根、drop ALL、NNP、768MiB内存、1CPU、384PIDs、64MiB临时目录。
  验证文档资源、OpenAPI/发现、JSON、示例增删改查、单/多文件上传和OAS3 SSE，并重启复验。
- CI 使用独立生成的测试证书/JVM信任库挂载检查信任路径，正反验证均需通过；不读取线上秘密。
  上线仍需对原 CA 及 JVM cacerts 挂载执行真实正常 TLS 与既有12条问题链拒绝验收，不能以CI合成证书替代。
- 先保存已验收镜像，再在独立发布 job 中加载、核对镜像配置和层内容指纹，推送唯一
  `sha-<源码SHA>-run-<运行ID>-<尝试次数>` 标签；两个候选均就绪后才推广 `demo`。
  两个标签无法在Registry中原子更新，但推广的每个镜像已通过全部门禁，不会推广未验收候选。

镜像地址：

```text
ghcr.io/songxychn/knife4j-next/knife4j-next-demo-openapi2:demo
ghcr.io/songxychn/knife4j-next/knife4j-next-demo-openapi3:demo
```

线上保持加速前缀 `ghcr-mirror.infra.baizhukui.com/…`。只有新镜像逐实例完成候选和公网验收后，
才将该服务的 Watchtower enable 改为 true；不要直接改回 Release `latest`，避免旧版本覆盖安全修补。
镜像内置非root默认用户与轻量文档健康检查；其余宿主运行限制仍由线上Compose持有。

## 本地验证

标准源码门禁按 `.agent/RUNBOOK.md` 执行；构建两 Demo 时需 JDK17、仓库指定 Node/Bun。

```sh
python3 -m unittest discover -s tools/demo-images -p 'test_*.py'
cd knife4j
mvn -B -ntp -pl knife4j-demo-openapi2,knife4j-demo-openapi3 -am -Dknife4j-skipTests=false verify
cd ..
python3 tools/demo-images/prepare.py 2
# 按 manifest.json 的 base/port 与 git rev-parse HEAD 传入 Docker build args，详见 workflow。
python3 tools/demo-images/verify.py 2 local/knife4j-demo-candidate:2 \
  --manifest knife4j/knife4j-demo-openapi2/target/demo-image/manifest.json \
  --report build/demo-images/demo-2-result.json
```

OAS3 同样执行。Docker 使用本机daemon与仅绑定127.0.0.1的临时端口；临时容器有专用唯一名称，
结束时只删除自身容器。测试证书和密钥不进入镜像或发布制品。

## 回退和边界

发布记录保留源码 SHA、唯一构建标签、镜像 digest、JAR校验和与验收结果。不要删除仍承担回退的仓库构建标签。
首次从 local 补丁镜像迁移时，需先保存旧镜像归档并验证可读，不能仅保留本地 rollback tag。
线上配置、原镜像和挂载校验和保留在服务器私有操作目录；失败时关闭对应服务自动更新并切回精确旧镜像。
用户已允许 Watchtower cleanup；这不授权删除数据备份，也不保证未来升级会自动回退。
新健康检查不替代业务验收。CA信任库覆盖不会随镜像自动更新，需要另行核验后才可移除。
