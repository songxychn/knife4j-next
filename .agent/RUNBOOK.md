# 运行手册

使用与改动匹配的**最窄**验证。小改动不要默认跑全套。

## 环境

- Java：`.java-version`
- JavaScript 运行时：当前源码的前端（OAS3、Vue3、docs、Knife4x UI 同步）使用稳定 Bun `1.4.x`，不需要安装 Node.js；`front/scripts/check-bun.cjs` 在安装和构建前检查。CI 覆盖最低版本 `1.4.0` 与 `1.4.x` 当前补丁，并通过 `tools/without-node.sh` 隔离独立 Node.js。旧 tag 的发布恢复按该 tag 的 `.nvmrc` 保留 Node 环境；GitHub JS actions 自带的运行时不属于项目依赖。
- 包管理：bun（`front/`、`front/vue3/`、`docs/`）。本地开发与 CI 统一使用根目录 `.bun-version` 声明的稳定 `1.4.x`。优先用已安装且满足范围的 Bun，无需仅因补丁版本不同而下载安装或降级；需要复现失败或 lock / 生成物差异时，按日志中的实际补丁版本复现。安装用 `bun install --frozen-lockfile`，不要恢复 `package-lock.json`。
- CI：`.github/workflows/build.yml`（PR / master 验证）、`release.yml`（Java 发布）、`deploy-demo.yml`（由 Release 调用）、`publish-demo-images.yml`（Demo 镜像，见 `tools/demo-images/README.md`）。
- 浏览器下限：OAS3 React UI（含 WebJar / Knife4x）为 Chrome/Edge 112、Firefox 116、Safari/iOS Safari 17；OAS2 Vue3 为 Chrome/Edge 117、Firefox 119、Safari 17.4。构建成功不代表旧浏览器兼容。
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

各脚本覆盖的内容见 [`tools/README.md`](../tools/README.md)。用 `git diff --name-only <base>...<head> | ./tools/ci-changes.sh` 核对 CI 影响范围；消费方与生成物相关门禁仍按对应契约执行。仅修改 `AGENTS.md`、`.agent/**` 等流程文案且分类全部为 false 时，核对实际 diff、运行 `git diff --check <base> <head>` 并完成独立措辞审查（符合 `.agent/COORDINATION.md`“低风险豁免”时由维护者合并前审阅承担），无需运行产品测试。验证通过后，仅在新变更、失败或未解决的风险影响结论时补跑。

强制：

- 改前端源码用对应脚本，不用单独 `tsc` / `vite build` 冒充全量。
- Java 改动的 PR / issue 应能指向 smoke 证据：本地 `test-java.sh` 尾部 `Smoke-tests evidence OK`，或 CI 的 smoke summary。
- 兼容报告中的真实 API 差异只是审查信号；基线、工具、发布模块或已登记契约异常是硬失败。
- 有意增删 Spring Boot 配置 key 时，构建后运行 `./tools/verify-java-compatibility-contracts.py --update-config`，人工核对 `tools/java-compatibility-contracts.tsv` 差异；不得为过门禁直接重生成。
- smoke 模块由 `tools/smoke-evidence.sh` 按 `knife4j-smoke-tests/*/pom.xml` 自动发现；增删模块只需同步 `knife4j-smoke-tests/pom.xml` 的 `<modules>`，目录存在但未进入 reactor 会被门禁拦下。

## 聚合实现共享源码

Boot2 与 Jakarta aggregation 保持独立发布模块。两者完全相同的纯实现只保存一份，位于 `knife4j/knife4j-aggregation-spring-boot-starter/src/shared/java`，两个模块通过 `build-helper-maven-plugin` 各自编译进自己的 JAR 与源码包。框架适配、Servlet API 等有意差异留在各自 `src/main/java`；需要让共享类分叉时，把它移回两侧 `src/main/java` 并在 PR 说明理由。共享源码不替代两端及 Boot4 的 smoke 验证。

## Schema Worker 浏览器门禁

标准前端构建后运行（Build CI 同样执行）：

```bash
bun front/ui-react/scripts/run-schema-example-worker-acceptance.mjs --smoke --static-root front/ui-react/dist
```

需要独立的无头 Chrome/Chromium（可用 `CHROME_PATH` 指定），不连接用户浏览器。去掉 `--smoke` 是专项完整验收（含性能统计）；smoke 不替代性能测量，也不证明所有最低浏览器版本。

## Bug 复现（强制）

凡 **bug / 回归 / 错误行为** 类任务（本仓 issue 或 upstream 关联），**先复现再写修复**。  
不适用于：纯文档、流程文案、明确的新功能、无行为主张的格式化/重构。

### OpenAPI / Swagger 附件先验（强制）

Issue 提供 OpenAPI / Swagger JSON 或 YAML 时，附件不是天然可信的产品契约，复现前必须：

1. **确定声明版本**：区分 Swagger 2.0、OAS 3.0、3.1、3.2，并以对应版本的官方规范为准；版本缺失、无法识别或本项目不支持时要求报告者补正，不得静默猜版本。第三方 validator 可能尚未支持新版本，只能作为辅助证据。
2. **验证结构与相关语义**：对整份文档执行当前可用的结构校验，并人工检查复现路径涉及的对象、字段位置、必填/互斥关系、参数 `style` / `explode` 默认值，以及 Schema / example 是否能表达 issue 声称的实例和行为；不要求人工证明整份大型 Schema 的全局可满足性。
3. **区分两类文档问题**：
   - 违反对应版本的强制结构或语义要求；
   - 形式上允许，但 Schema 不可满足、example 与 Schema 不一致，或其他语义无法表达报告者声称的意图。
   两类都不能证明其所主张的展示、解析或序列化行为是 Knife4j bug，也都应要求报告者修正文档；issue 回复中必须准确说明属于哪一类，不能把后一类笼统写成“违反规范”。
4. **正确识别扩展边界**：只在规范允许 Specification Extensions 的对象上把 `x-*` 视为合法扩展；OAS 3.1+ Schema Object 还可能使用其他 JSON Schema vocabulary / 关键字，不能仅因其不以 `x-` 开头就判定非法。标准允许且项目明确支持的扩展不属于非规范兼容。
5. **不为错误契约做兼容**：在 issue 中指出具体字段路径和规范/意图问题，要求报告者修正生成器或手写文档；不得增加 alias、猜测、自动转换或其他兼容分支来接受该文档。若等价的规范最小夹具在未打补丁基线上仍会失败，可以确认独立的工具问题；红灯证据、实现范围和回归测试只覆盖规范夹具，并明确原附件仍需修正。
6. **保留安全拒绝责任**：不规范输入若另行暴露崩溃、卡死、XSS、资源耗尽或无法给出安全诊断等问题，按独立的健壮性/安全问题处理；修复目标是安全拒绝或清晰诊断，非法夹具只验证拒绝行为，不得把它兼容成合法输入。

### 通用步骤

1. **读完问题描述并补齐事实**：堆栈、触发步骤、版本组合、期望 vs 实际；含 OpenAPI / Swagger 附件时先完成上述规范校验。
   - **先自行调查**：通过仓库、版本配置、提交历史、issue / PR 和可用日志查证；能在已授权范围内自行查明的信息，不要求维护者重复提供。
   - **识别必要缺口**：仅当缺失信息影响复现契约、支持版本、外部行为或授权边界，且无法自行查明或需要维护者决策时，才请求补充或确认。不得猜测附件规范版本、扩大支持范围或绕过已有审批要求。
   - **限定阻塞范围**：在 issue 评论中说明已有证据、必要缺口及其影响；只暂停依赖该信息的步骤，继续不依赖该信息的已授权工作。当剩余工作均无法推进时，再标 `status:blocked` 并说明需要维护者、环境或上游提供的解阻条件。
2. **在未打补丁的 master（或任务指定的基线）上复现**，留下可核对证据（命令输出、HTTP 响应、日志片段、失败测试）。证据贴 issue 评论。
3. **复现手段按区域选择**（能自动化的优先自动化）：
   - Java / starter / 兼容：优先 `knife4j-smoke-tests/` 复用或新建最小工程；相关版本**显式 pin**；登记 smoke 列表（见上）。
   - `front/core`：失败单测或最小解析夹具。
   - UI：最小复现步骤 + 能固定的测试/断言；纯视觉问题至少写清浏览器与操作路径及截图/描述。
4. **复现不到**：写明已尝试条件；若历史已修则 close 并链 commit；否则 `status:blocked` 等补充信息。**禁止**空想 try-catch / null-guard /「防御性」补丁。
5. **能复现**：先增加（或确认）在修复前会失败的断言/复现步骤，再修；修后同一证据应变绿或现象消失。

### UI 截图上传

需要在本仓 issue / PR 展示截图时，可直接使用维护者本机的 PicGo / PicList：

```bash
./tools/upload-images.sh /absolute/path/before.png /absolute/path/after.png
```

脚本通过 `127.0.0.1:36677` 调用本机 PicGo，验证公开 URL 后输出可粘贴的 Markdown。维护者已持续授权上传本仓任务产生的**非敏感图片**，无需逐次询问。上传前必须检查截图并遮盖 Authorization、Cookie、JWT、Access Token 等敏感内容；不要上传配置、日志或其他可能含凭据/隐私的文件。该授权不包含修改图床配置、删除远端对象或上传本仓任务以外的文件。

PicGo / PicList 必须已启动，并已选中可用的默认图床配置；脚本不指定图床类型或配置名。图床凭据只保存在本机应用中，禁止写入仓库或日志；截图二进制也不要提交到仓库。

上传请求超时或公开链接验证失败时，远端对象仍可能已经创建；先检查 PicList 相册或返回记录，不要盲目重试。

### 额外：upstream 关联

正文含 `Upstream: ...` 或标题带 `(upstream #N)` 时，还须读完 upstream 原文、堆栈与评论再定范围；若本仓只做衍生增强，issue 须写明**不自认为修了 upstream #N**。

## PR 与 CI

`push` / 开 PR **不是**完成。运行 `gh pr checks <N> --watch`；CI 红按下文“验证失败时”处理，当前 head 全绿且审查结论具备后才标 `status:review`。PR 至少写清关联 issue、范围、验证命令与结果、风险。

## 正式发布验收

### 授权与默认范围

须维护者明确授权后再创建或推送 tag。按 `AGENTS.md`，维护者要求“发布新版本”且未限定语言时，已授权发布所有具备正式发布流程的语言版本，无需为各语言重复请求发布授权；明确限定语言时按指定范围执行。此授权不免除各语言的发布前门禁。

当前默认范围为 Java（Knife4j Next）与 Go（Knife4x Go）；Rust 仍是占位目录，没有可发布包，不纳入。各语言按自身版本体系升级，不要求版本号相同。正式发布前列明本次各语言的目标版本、tag 与候选提交，并核对各自发布说明及发布前门禁；仅准备候选、验证或创建发布 PR 不等于获准创建或推送 tag。

### 发布文案

发布准备 PR 同步 README、接入 / 迁移示例、版本表、发布说明等当前入口的目标版本，移除“待发布”“准备发布”“正式发布前请使用旧版”等准备态文案和上一版的“最新”标记；准备阶段用“当前版本”“以下示例使用 X”等中性表述，实际发布状态和未完成步骤记录在 issue / PR，完成声明仍以发布验收为准。打 tag 前逐项复核，不得留到发布后补做。`tools/verify-current-version-docs.py` 只拦截 Maven 坐标、“示例使用 Java X”“当前源码版本”与发布说明“最新”标记，不覆盖 Go 版本和其他自由文字，不能替代复核。历史版本记录与兼容边界保持原样。

### Java

按 `.github/workflows/release.yml` 发布，同时满足才算完成：

- `vX.Y.Z` tag 已推送
- `Release` workflow 的发布与公开制品核验 job 成功，同一 run 中随后的 `deploy-demo` job 成功
- Maven Central 目标构件可访问
- GitHub Release 存在且 body 与 `docs/release-notes/index.md` 对应小节一致（缺 Release 不得报完成）

### Go

按 [Knife4x Go 发布清单](../knife4x/go/RELEASE.md) 执行发布前门禁、创建并推送 `knife4x/go/vX.Y.Z` tag，以及发布后公共消费验证；清单中的具体版本号按本次目标版本替换。完成条件同时满足：

- 公共 Go proxy 的 origin hash / ref 与目标 tag 对应的提交及子目录 tag 一致
- `sum.golang.org` 存在 module 与 `go.mod` 两条 checksum
- 全新 consumer 通过公共 proxy 下载目标版本，无 `replace`，编译、Handler 运行与下载内容检查均通过

Go 沿用独立的版本与 tag，不额外要求 Java Release workflow、Maven Central 或 GitHub Release；仅发布 Go 时不触发 Java 发布及其 Demo 部署。

### 整体完成条件

授权范围内所有语言都通过验收才能报“发布完成”；部分完成时逐项说明各语言的版本、已完成步骤、未通过项与阻塞原因。

## 验证失败时

1. 记录精确失败命令
2. 判断是否本任务引入
3. 超范围 → `status:blocked` 或后续 issue
4. 不要为了“看起来完成”降低验证标准
