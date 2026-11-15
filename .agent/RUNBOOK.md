# 运行手册

使用与改动匹配的**最窄**验证。小改动不要默认跑全套。

## 环境

- Java：`.java-version`
- Node：前端（OAS3、Vue3、docs、Knife4x UI 同步）只支持稳定的 `26.x`，日常用 `.nvmrc` 选择的 26 系列最新补丁；`front/scripts/check-node.cjs` 在安装和构建前检查。
- 包管理：bun（`front/`、`front/vue3/`、`docs/`）。本地优先用已安装的 Bun，版本字符串不同本身不是降级理由；只有失败可归因于版本、lock / 生成物出现差异或需复现 CI 时，才切换到根目录 `.bun-version`。安装用 `bun install --frozen-lockfile`，不要恢复 `package-lock.json`。
- CI：`.github/workflows/build.yml`（PR / master 验证）、`release.yml`（Java 发布）、`deploy-demo.yml`（由 Release 调用）、`publish-demo-images.yml`（Demo 镜像，见 `tools/demo-images/README.md`）。
- 浏览器下限：OAS3 React UI（含 WebJar / Knife4x）为 Chrome/Edge 112、Firefox 116、Safari 17；OAS2 Vue3 为 Chrome/Edge 117、Firefox 119、Safari 17.4。构建成功不代表旧浏览器兼容。
- React Vitest 注意事项见 [`front/ui-react/README.md`](../front/ui-react/README.md#测试注意事项)。

## 验证命令

| 改动 | 命令 |
|---|---|
| `knife4j/**` Java | `./tools/test-java.sh` |
| Java 发布面差异 | `./tools/java-compatibility-report.sh`（需先完成 Java 构建） |
| `front/schema-engine`、`front/core`、`front/ui-react` | `./tools/test-front-core.sh` |
| `front/vue3` | `./tools/test-vue3.sh` |
| `docs/**` | `./tools/test-docs.sh` |
| `knife4x/go/**`、`knife4x/examples/gin/**` | `./tools/test-knife4x-go.sh` |
| 跨多区域 | 受影响区域标准脚本的并集，含生成物与消费方 |
| 全区域变更 / 整体验收 | `./tools/test-all.sh` |

各脚本覆盖的内容见 [`tools/README.md`](../tools/README.md)。用 `git diff --name-only <base>...<head> | ./tools/ci-changes.sh` 核对 CI 影响范围；只改流程文案且分类全为 false 时，核对 diff 并运行 `git diff --check`，无需产品测试。验证通过后，仅在新变更、失败或未解决的风险影响结论时补跑。

强制：

- 改前端源码用对应脚本，不用单独 `tsc` / `vite build` 冒充全量。
- Java 改动的 PR / issue 应能指向 smoke 证据：本地 `test-java.sh` 尾部 `Smoke-tests evidence OK`，或 CI 的 smoke summary。
- 兼容报告中的真实 API 差异只是审查信号；基线、工具、发布模块或已登记契约异常是硬失败。
- 有意增删 Spring Boot 配置 key 时，构建后运行 `./tools/verify-java-compatibility-contracts.py --update-config`，人工核对 `tools/java-compatibility-contracts.tsv` 差异；不得为过门禁直接重生成。
- 增删 smoke 模块时同步更新 `tools/test-java.sh` 的 `SMOKE_MODULES` 与 `.github/workflows/build.yml` 中的 summary 列表，两处必须一致。

## 聚合实现同步

Boot2 与 Jakarta aggregation 保持独立发布模块。`tools/aggregation-shared-sources.txt` 明确登记需同步的纯实现，Java 标准脚本执行逐字节一致性检查；修改其中一端时同步另一端。框架适配、Servlet API 与其他有意差异不在清单内。新增或移除登记项必须说明共享/分叉理由，不得为通过门禁直接重新生成清单。此检查只防止实现漂移，不替代两端及 Boot4 的 smoke 验证。

## Schema Worker 浏览器门禁

Build CI 在前端构建后运行：

```bash
node front/ui-react/scripts/run-schema-example-worker-acceptance.mjs --smoke --static-root front/ui-react/dist
```

需要独立的无头 Chrome/Chromium（可用 `CHROME_PATH` 指定），不连接用户浏览器。去掉 `--smoke` 是专项完整验收（含性能统计）；smoke 不替代性能测量，也不证明所有最低浏览器版本。

## Bug 复现（强制）

凡 **bug / 回归 / 错误行为** 类任务（本仓 issue 或 upstream 关联），**先复现再写修复**。不适用于纯文档、流程文案、明确的新功能和无行为主张的重构。

### OpenAPI / Swagger 附件先验（强制）

1. **确定声明版本**（Swagger 2.0 / OAS 3.0 / 3.1 / 3.2），以对应官方规范为准；版本缺失或不受支持时要求报告者补正，不猜版本。第三方 validator 只作辅助证据。
2. **验证结构与复现路径语义**：整份文档跑结构校验，并人工检查复现路径涉及的字段位置、必填 / 互斥、`style` / `explode` 默认值，以及 Schema / example 能否表达 issue 声称的行为。
3. **准确归类**：区分“违反强制要求”与“形式合法但不可满足 / example 与 Schema 不一致 / 无法表达意图”。两类都不能作为 Knife4j bug 契约，都要求报告者修正，但回复中要写清是哪一类。
4. **扩展边界**：`x-*` 只在规范允许扩展的对象上合法；OAS 3.1+ Schema 可能使用其他 JSON Schema 关键字，不能仅因不以 `x-` 开头判定非法。
5. **不为错误契约做兼容**：指出字段路径与问题，不加 alias、猜测或自动转换。等价的规范最小夹具在基线上仍失败时，才确认工具问题，红灯证据与回归测试只覆盖规范夹具。
6. **安全拒绝**：非规范输入导致崩溃、卡死、XSS 或资源耗尽时，按健壮性 / 安全问题处理，目标是安全拒绝或清晰诊断，而不是兼容。

### 通用步骤

1. **补齐事实**：堆栈、触发步骤、版本组合、期望与实际。先从仓库、提交历史、issue / PR 和日志自行查证；只对影响复现契约、支持版本、外部行为或授权、且无法自行查明的缺口请求补充，并只暂停依赖它的步骤。全部无法推进时再标 `status:blocked` 并写明解阻条件。
2. **在未打补丁的 master（或指定基线）上复现**，证据（命令输出、HTTP 响应、日志、失败测试）贴 issue。
3. **按区域选手段**：Java / starter 优先在 `knife4j-smoke-tests/` 建最小工程并显式 pin 版本；`front/core` 用失败单测或最小夹具；UI 用可固定的测试或断言，纯视觉问题写清浏览器、操作路径和截图。
4. **复现不到**：写明已尝试条件；历史已修则关闭并链接 commit，否则 `status:blocked`。**禁止**空想的 try-catch / null-guard 防御性补丁。
5. **能复现**：先加修复前会失败的断言，再修；修后同一证据转绿。

### UI 截图上传

```bash
./tools/upload-images.sh /absolute/path/before.png /absolute/path/after.png
```

脚本调用本机 PicGo / PicList（`127.0.0.1:36677`，需已启动并选好默认图床），验证公开 URL 后输出 Markdown。维护者已持续授权上传本仓任务产生的**非敏感图片**。

- 上传前检查并遮盖 Authorization、Cookie、JWT、Token 等敏感内容；不上传配置、日志等可能含凭据的文件，截图不提交到仓库。
- 授权不含修改图床配置、删除远端对象或上传任务以外的文件；图床凭据只留在本机应用。
- 超时或链接验证失败时远端对象可能已创建，先查 PicList 相册，不要盲目重试。

### 额外：upstream 关联

正文含 `Upstream: ...` 或标题带 `(upstream #N)` 时，还须读完 upstream 原文、堆栈与评论再定范围；若本仓只做衍生增强，issue 须写明**不自认为修了 upstream #N**。

## PR 与 CI

`push` / 开 PR **不是**完成。运行 `gh pr checks <N> --watch`；CI 红按下文“验证失败时”处理，当前 head 全绿且审查结论具备后才标 `status:review`。PR 至少写清关联 issue、范围、验证命令与结果、风险。

## 正式发布验收

### 授权与范围

须维护者明确授权后再创建或推送 tag。“发布新版本”未限定语言时，授权覆盖所有具备正式发布流程的语言（当前为 Java 与 Go；Rust 是占位目录，不纳入），不免除各语言的发布前门禁；限定语言时按指定范围。各语言按自身版本体系升级，不要求版本号相同。发布前列明各语言目标版本、tag 与候选提交。准备候选或发布 PR 不等于获准推送 tag。

### 发布文案

发布准备 PR 同步 README、接入 / 迁移示例、版本表、发布说明等当前入口的目标版本，移除“待发布”“准备发布”“正式发布前请使用旧版”等准备态文案和上一版的“最新”标记；准备阶段用“当前版本”“以下示例使用 X”等中性表述，实际发布状态记录在 issue / PR。打 tag 前逐项复核。`tools/verify-current-version-docs.py` 只拦截 Maven 坐标、“示例使用 Java X”“当前源码版本”与发布说明“最新”标记，不覆盖 Go 版本和其他自由文字，不能替代复核。历史版本记录与兼容边界保持原样。

### Java

按 `.github/workflows/release.yml` 发布，同时满足才算完成：

- `vX.Y.Z` tag 已推送
- `Release` workflow 的发布与公开制品核验 job 成功，同一 run 中随后的 `deploy-demo` job 成功
- Maven Central 目标构件可访问
- GitHub Release 存在且 body 与 `docs/release-notes/index.md` 对应小节一致（缺 Release 不得报完成）

### Go

按 [Knife4x Go 发布清单](../knife4x/go/RELEASE.md) 推送 `knife4x/go/vX.Y.Z` tag，同时满足才算完成：

- 公共 Go proxy 的 origin hash / ref 与目标 tag 的提交及子目录一致
- `sum.golang.org` 存在 module 与 `go.mod` 两条 checksum
- 全新 consumer 不用 `replace`，经公共 proxy 下载目标版本并编译、运行 Handler、检查下载内容

仅发布 Go 时不触发 Java 发布及 Demo 部署。

### 整体完成

授权范围内所有语言都通过验收才能报“发布完成”；部分完成时逐项说明各语言的版本、已完成步骤、未通过项与阻塞原因。

## 验证失败时

1. 记录精确失败命令
2. 判断是否本任务引入
3. 超范围 → `status:blocked` 或后续 issue
4. 不要为了“看起来完成”降低验证标准
