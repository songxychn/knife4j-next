# 已知陷阱

## 项目级

- 这是一个 fork，因此部分文档、包元数据和仓库 URL 仍可能指向 upstream 历史。
- 即使澄清当前维护归属，也要保留历史署名和感谢。
- 仓库包含多个子项目，工具链和成熟度不同。不要假设一个验证命令覆盖所有区域。

## Java

- `knife4j` 是影响最大的维护区域，小改动也可能影响大量下游用户。
- 发布流程通过 `.github/workflows/release.yml` 串联；自治 agent 未经批准不得触发或修改发布流程。
- 兼容性修复通常隐藏着 Spring Boot 2.x、3.x、servlet、jakarta 等矩阵成本。

## 前端

- `knife4j-front/knife4j-core` 有直接 test/lint/build 命令，是最适合自治任务的前端区域。
- `knife4j-front/knife4j-ui-react` 属于探索区，不要通过实现暗示产品级承诺。
- 部分前端模块的 package metadata 可能仍反映 upstream 信息；除非涉及运行时行为，否则把 metadata 清理视作文档/仓库工作。

## 文档

- `README.md` 可能有意引用 upstream 作为历史或临时参考。目标是去除混淆，不是抹掉来源。
- 文档构建依赖 `npm ci`，因此环境和 lockfile 一致性很重要。

## Agent 工作流

- 不要让任务存在理由只保存在临时聊天上下文里。
- 不要把“修一个点”静默扩大成“顺手清理相关区域”。
- 不确定时，把不确定性写下来，并停在安全检查点。
- **Reviewer 声称某改动 "revert 了 X" / "删除了 Y" 时，coordinator 必须在接受结论前用 `git show <commit> -- <file>` 核对真实 diff**。历史案例：#198 三次 reviewer `block` 指控 commit `8f0d3b6f` 把 `ProductionSecurityFilter` revert 回 `sendError`、默认值 `knife4j.basic.enable` 翻转、删除 `addCustomApiDocsPathRule`，经人工复核**全部与 master 实际代码相反**；推测 reviewer 对照了 worker 未提交的 stash 或错误 base。不先核对 diff 就按 reviewer 描述动代码，会把正确修复改回 bug。
- **上游 issue（`upstream #xxx`）必须先在当前仓库复现，再决定是否需要修复**。本仓库是 `knife4j` 的 fork，upstream 报告的 bug 可能在以下情况下**已经不再存在**：
  - 当前已升级到修复版本的依赖（如 springdoc、Spring Boot）；
  - 当前 fork 已经在历史提交里修过同一问题；
  - upstream 触发条件依赖特定旧版本 + 特定配置组合，当前默认配置已规避。
  动手前必须做的最小复现工作流：
  1. 在 `knife4j-smoke-tests/` 下挑或新建一个尽量贴合 upstream 复现条件的最小工程（pin Spring Boot / springdoc / 触发用 controller）；
  2. 在**未应用任何修复**的 master 状态下跑该工程，确认 bug 真的会出现（异常堆栈、错误响应、错误日志等），把证据贴进 issue；
  3. 如果**复现不到**：在 issue 里写明已尝试的复现条件并 close 或转 `status:blocked` 等待上游补充信息，**不要凭想象写 try-catch / null guard 类"防御性"代码**，那只是制造噪音和静默吞错；
  4. 如果**能复现**，再开始设计修复方案，并保留该 smoke 工程作为修复后回归测试的载体。
  反面案例：#303（upstream #961）经过 2 轮 worker+reviewer 循环都被 block，根因就是没有先复现，worker 直接在 `Knife4jJakartaOperationCustomizer.customize()` 外层包了 `try-catch(NullPointerException)`。更糟的是，回去核对 upstream 原文堆栈才发现实际异常是 `java.lang.StackOverflowError`，堆栈顶是 springdoc 的 `MethodParameterPojoExtractor` / `ReturnTypeParser` 递归；该 NPE/SOE 实际抛在 springdoc 内部、调用 `customize()` 之前，这层 try-catch 在 JVM 调用栈上根本拦不到；同时 smoke test 只断言 `/v3/api-docs` 返回 200，去掉 try-catch 也会过，是典型的 false positive。
- **不要凭 upstream 标题 / 单张截图臆测本仓库任务范围**。triage upstream issue 时必须读完 upstream 正文 + 堆栈 + 评论，再确认本仓库 code path 是否命中；可以"以 upstream 为灵感定义本仓库的增强"，但必须在本仓库 issue 正文里**显式声明已经换了范围**，不要让 PR 看起来像"修了 upstream"但实际修了别的东西。
  历史误读案例（2026-05 audit 发现）：
  - **#303 (upstream #961)**：upstream 正文第一行异常实际是 `java.lang.StackOverflowError`，堆栈顶是 springdoc `MethodParameterPojoExtractor` / `ReturnTypeParser` 递归；但 issue 标题被 worker 读成 `NullPointerException`（"null" 字样误导），连续 2 轮方向错误。正确修复路径是升级 springdoc 版本，已拆到 #335 跟踪。
  - **#285 / PR #331 (upstream #833)**：upstream 原文只说"右上角搜索结果出现重复的三个"+ 一张截图；本仓库 issue #285 把它引申成"group 间搜索串扰"，PR #331 实现 `setSearchText('')` on group switch。这可能**部分缓解**现象，但 upstream 反映的更可能是网关聚合把同一 endpoint 注册多次，**与 searchText 状态无关**。PR merge 了，但 upstream 真正的 bug 由 #338 独立跟踪。以后类似情况，issue 正文应写"**不自认为修了 upstream #xxx**，而是修了衍生场景"。
  - **#226 / PR #237 (upstream #917)**：upstream 是 `gateway-spring-boot-starter` 配 basic auth 后 `/doc.html` 返回 500 的**后端** bug；本仓库 #226 正文显式转译为"ui-react 在 401 响应时自动弹认证框"的 UX 任务。PR 实现了一个真实 ui-react bug（401 check 错位）。这是**合理的范围转译**，因为 issue 正文已清楚声明"是 UX 缺口，与 upstream 行为不一致"——可作正面示范。
  - **#239 / commit `982959a8` (upstream #666 #859)**：upstream #666 / #859 是**webjars 静态资源 MIME / MessageConverter 顺序** bug；commit message 却声称在修 `ProductionSecurityFilter`。`ProductionSecurityFilter` 只在 `knife4j.production=true` 时生效，和 webjars 静态资源完全无关；`sendError(403)` 本身是一个合理的小重构（让 servlet 容器决定 Content-Type），但**它没修 upstream #666 / #859 所描述的问题**。upstream 本体已由 #339 独立跟踪。
- **"先 deref 再 null check"类的 `@Bean` 方法 null-guard 通常是假 bug**。`@Bean` 方法的参数是 Spring 从容器注入的 bean，Spring **不会注入 null**（找不到就抛 `NoSuchBeanDefinitionException`，不会静默注入 null）。所以 `@Bean` 方法里 `if (injectedBean == null)` 分支永远是死代码，"修它"并不解决任何实际问题，只是代码美化。不要把这类重构包装成 bug fix；需要的话可以写 `fix:`，但 commit message 要说明"纯重构，运行时行为不变"。历史案例：PR #246（#239）。
- **一次 commit / 一个 PR 不要绑多个 upstream issue**。历史案例：commit `8f0d3b6f`（#198）在一次直推 master 中同时声明修 5 个 upstream issue（#816 #666 #859 #573 #849），结果其中 #666（webjars MIME 问题）方向完全错误、#573 / #849（pathMapping / configUrl）修的是"保护自定义 api-docs 路径"——与用户真实诉求无关且对 basic-auth 场景向后不兼容；审计时连带验证通过的 smoke test `shouldServeCustomApiDocsPath` 实际与修复内容解耦（不启用 basic/production 仍然走 springdoc 原生路径），测试绿并不能证明修复有效。教训：一分支一任务 / 一 commit 一 issue；smoke test 必须构造 upstream 报告的具体场景再断言修复，否则等于没测。
- **绕过 PR 直推 master 必须在 review 期再审计**。`8f0d3b6f` 以 `worker <worker@knife4j>` 作者身份直推 master，未经过 PR review；事后审计是发现"方向错误 + 向后不兼容"的唯一手段。现行约定：所有 agent 改动必须经 PR，master 的 non-merge commit 默认需要事后审计。
