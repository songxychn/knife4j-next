# 运行手册

使用与改动匹配的**最窄**验证。小改动不要默认跑全套。

## 环境

- Java：`.java-version`
- Node：OAS3、Vue3、docs 和 Knife4x UI 同步统一只支持稳定的 `26.x`，其他主版本与预发行版不在支持范围内。`.nvmrc` 选择 26 系列，日常使用该系列最新补丁；三组前端 CI 均验证 26.0.0 下限与 26 系列当前补丁。共享检查为 `front/scripts/check-node.cjs`，标准脚本在安装前检查，直接开发/构建入口也执行检查。
- 前端包管理：bun（`front/`、`front/vue3/`、`docs/`）；CI / Demo / Release 基准版本读取根目录 `.bun-version`
- CI：`.github/workflows/build.yml`、`release.yml`

React 的两个 Vitest project 通过 `execArgv` 显式关闭 Node 原生实验性 Web Storage（`--no-experimental-webstorage`），使集成测试继续使用 jsdom 的浏览器存储；Node 26 的全局 `localStorage` 否则会遮住 Vitest 4 的环境注入。Vitest worker 不会自动继承主进程的此项 CLI 参数，不能只改启动命令。此选项只影响测试进程，不改变页面或生产构建。

Vitest 5 升级显式保留 `clearMocks:false`，React 的两个 inline project 还保留 `extends:false`，以维持原来的 mock 历史及配置隔离。参数化用例中的字符串标签不再自动带单引号；`-t` 跨 suite 的完整名称使用 ` > ` 分隔，手工筛选时可匹配单段名称或用通配正则连接各段。`vitest list` 默认静态解析，不能用它的条目数核对运行时参数化用例；需要完整集合时使用 `vitest list --no-staticParse --json`。标准测试命令、测试源码、断言和发现规则不随框架升级修改。

当前源码的 OAS3 React UI（含 WebJar / Knife4x）浏览器下限为 Chrome/Edge 112、Firefox 116、
Safari/iOS Safari 17，JSONPath 11 依赖原生 RegExp `v` 标志；不能把构建成功当成旧浏览器兼容。
OAS2 Vue3 仍沿用 Chrome/Edge 117、Firefox 119、Safari 17.4。Node 与编译器安排不随之改变。

本地与 agent 优先使用当前已安装的 Bun；版本字符串不同本身不构成下载安装或降级理由。先运行受影响区域的标准验证，只有失败可归因于版本、lock / 生成物发生差异，或需要复现 CI / 发布环境时，才切换到 `.bun-version`。安装使用 `bun install --frozen-lockfile`，不要恢复 `package-lock.json`。

## 验证命令

| 改动 | 命令 | 说明 |
|---|---|---|
| `knife4j/**` Java | `./tools/test-java.sh` | spotless + verify + smoke 证据与兼容契约门禁 |
| Java 发布面差异 | `./tools/java-compatibility-report.sh` | 与显式 Central 基线比较并生成 report-first artifact；需先完成 Java 构建 |
| `front/core`、`front/ui-react` | `./tools/test-front-core.sh` | format / lint / test / build（对齐 CI） |
| `front/vue3` | `./tools/test-vue3.sh` | 构建并检查 `doc.html` / webjars |
| `docs/**` | `./tools/test-docs.sh` | 文档站构建 |
| `knife4x/go/**`、`knife4x/examples/gin/**` | `./tools/test-knife4x-go.sh` | Go 与 Gin 示例验证 |
| 跨多区域 | 受影响区域标准脚本的并集 | 包含生成物与消费方影响，不因跨两个区域就默认跑全套 |
| 全区域变更 / 整体验收 | `./tools/test-all.sh` | Java、React/core、Vue3、文档站、Go 及 UI 生成物一致性 |

选择区域时可用 `git diff --name-only <base> <head> | ./tools/ci-changes.sh` 核对 CI 影响范围；消费方与生成物相关门禁仍按对应契约执行。仅修改 `AGENTS.md`、`.agent/**` 等流程文案且分类全部为 false 时，核对实际 diff、运行 `git diff --check <base> <head>` 并完成独立措辞审查，无需运行产品测试。验证通过后，仅在新变更、失败或未解决的风险影响验证结论时补跑相关检查。

强制：

- 改前端源码时用对应脚本，不要用单独 `tsc` / `vite build` 冒充全量。
- Java 改动的 PR / issue 应能指向 smoke 证据：本地 `test-java.sh` 尾部 `Smoke-tests evidence OK`，或 CI 的 smoke summary。
- Java 标准脚本包含 OAS3 UI 冷/热工作区回归：真实 Maven package 的 WebJar 文件与字节必须等于显式 core/schema + Vite 构建，残留旧 `lib` 不得改变打包结果；core/schema 编译失败须在 Vite 前终止。
- Java 标准脚本包含 OAS2 Vue3 增量 WebJar 回归：真实冷/热 Maven package 的 classes/JAR 必须与当前 dist 映射及静态资源的完整集合、字节一致；覆盖过期分块、图标、gzip、源码包生命周期回入与外部符号链接保护。
- Java CI 的兼容报告只把真实 API / 实现差异作为审查信号，不因差异本身失败；基线、工具、发布模块或已登记配置/公开入口契约异常仍是硬失败。单模块分析忽略缺失外部类，不能替代消费方测试。
- 有意增删 Spring Boot 配置 key 时，构建后运行 `./tools/verify-java-compatibility-contracts.py --update-config`，人工核对 `tools/java-compatibility-contracts.tsv` 后再执行标准 Java 验证；不得为过门禁直接重生成并跳过语义审查。
- 增删 smoke 模块时同步更新 `tools/test-java.sh` 的 `SMOKE_MODULES` 与 `.github/workflows/build.yml` 中的 summary 列表（若仓库已抽出 `tools/smoke-modules.txt` 则只改该文件）。

## 聚合实现同步

Boot2 与 Jakarta aggregation 保持独立发布模块。`tools/aggregation-shared-sources.txt` 明确登记需同步的纯实现，Java 标准脚本执行逐字节一致性检查；修改其中一端时同步另一端。框架适配、Servlet API 与其他有意差异不在清单内。新增或移除登记项必须说明共享/分叉理由，不得为通过门禁直接重新生成清单。此检查只防止实现漂移，不替代两端及 Boot4 的 smoke 验证。

## Schema Worker 浏览器门禁

标准前端构建后运行：

```bash
node front/ui-react/scripts/run-schema-example-worker-acceptance.mjs --smoke --static-root front/ui-react/dist
```

Build 的 Node 26 当前补丁任务执行此门禁，读取该次 Vite 产物；覆盖三个部署前缀、普通示例与资源语义、原生慢正则取消/超时和恢复、CSP/404/MIME 启动拒绝。缺少 Chrome/Chromium 时失败，可通过 `CHROME_PATH` 指定独立无头浏览器；不连接用户浏览器。

专项完整验收去掉 `--smoke`，额外执行 dispose、作者示例超时和 30 次取消延迟统计。省略 `--static-root` 时保留原有 Knife4x 嵌入产物验收。smoke 不替代完整性能测量，也不证明所有最低浏览器版本。

CI 分类中 Schema 生产源码与 React/core 一样包含 Java 和 Go 消费方；独立测试文件只跑前端门禁，五个前端包/根 README 不触发产品构建。混合变更取并集，未知路径仍全量。

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

正文含 `Upstream: ...` 或标题带 `(upstream #N)` 时，在上述步骤之外还须：

- 读完 upstream 原文、堆栈与评论，再定本仓范围。
- 若本仓只做衍生增强，issue 须写明**不自认为修了 upstream #N**。

## PR 与 CI

`push` / 开 PR **不是**完成。完成后：

```bash
gh pr checks <N> --watch
```

CI 红：先按下文「验证失败时」确认原因；本任务引入且在授权范围内的失败，同分支修复后重新验证和等待当前 head 的 CI。全绿且审查结论具备后，才标 `status:review`。

PR 至少写清：关联 issue、范围、验证命令与结果、风险。

## 正式发布验收

须维护者明确确认后再 tag。完成条件同时满足：

- `vX.Y.Z` tag 已推送
- `Release` workflow 的发布与公开制品核验 job 成功
- 由 `Release` workflow 在核验成功后调用的 `Build and Deploy Demo` workflow 成功
- Maven Central 目标构件可访问
- GitHub Release 存在且 body 与 `docs/release-notes/index.md` 对应小节一致

缺 GitHub Release 不得报「发布完成」。

## 验证失败时

1. 记录精确失败命令  
2. 判断是否本任务引入  
3. 超范围 → `status:blocked` 或后续 issue  
4. 不要为了“看起来完成”降低验证标准  
