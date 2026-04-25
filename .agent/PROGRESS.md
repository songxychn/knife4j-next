# 进度日志

新记录追加在底部。

## 模板

```md
## YYYY-MM-DD HH:MM TZ
task: TASK-000
agent: <名称>
branch: <分支名>
status: in_progress | blocked | review | done
summary:
- 简短事实
- 简短事实
validation:
- 命令和结果
next:
- 下一步
blockers:
- blocker，如无则写 none
```

## 2026-04-23 19:27 UTC
task: TASK-003
agent: knife4j-next-bot
branch: codex/TASK-003-java-smoke-coverage
status: review
summary:
- 新增 knife4j-smoke-tests/boot3-app 子模块
- 使用 knife4j-openapi3-spring-boot-starter（Boot 2.x + OpenAPI 3，非 jakarta）
- Spring Boot 版本 2.7.18（TASK notes 中 4.0.1 有误，已修正）
- Boot3DocHttpSmokeTest 验证 /doc.html 和 /v3/api-docs 返回 200
- 注册到 knife4j-smoke-tests/pom.xml modules
validation:
- `JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 mvn -B -ntp -Dknife4j-skipTests=false verify` → BUILD SUCCESS（全部 17 模块）
next:
- 等待人工 review PR #7
- PR 合并后可推进 TASK-008（Boot 3.4/3.5 兼容性）
blockers:
- 无
pr: https://github.com/songxychn/knife4j-next/pull/7

## 2026-04-24 08:25 UTC
task: TASK-002
agent: knife4j-next-bot
branch: codex/TASK-002-doc-ownership-audit
status: review
summary:
- 审计所有 docs-site 和 README 的归属表述，整体清晰无误导
- 修复 README 文档站命令和链接（knife4j-doc 已废弃 → docs-site）
- 修复 README 模块表格，补充 docs-site 行，knife4j-doc 标注已废弃
- 移除 compatibility.md 本地绝对路径泄露
- 修正 getting-started.md VitePress dev 端口 4173 → 5173
validation:
- cd docs-site && npm ci && npm run build → build complete in 5.73s ✓
next:
- 等待人工 review PR #11
blockers:
- 无
pr: https://github.com/songxychn/knife4j-next/pull/11

## 2026-04-23 21:58 UTC
task: TASK-009
agent: knife4j-next-bot
branch: codex/TASK-009-fix-gateway-context-path
status: review
summary:
- PathUtils.processContextPath 加前导斜杠保护，防止 host 拼接缺少 /
- OpenAPIEndpoint.configUrl 改为 PathUtils.append(basePath, "/v3/api-docs/swagger-config")
- 新增 PathUtilsTest.test_processContextPath_leadingSlash 回归测试
validation:
- JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 mvn -B -ntp -Dknife4j-skipTests=false verify → BUILD SUCCESS（16 模块）
next:
- 等待人工 review PR #8
blockers:
- 无
pr: https://github.com/songxychn/knife4j-next/pull/8

## 2026-04-23 19:27 UTC
task: TASK-007
agent: knife4j-next-bot subagent
branch: codex/TASK-007-fix-basic-auth-bypass
status: review
summary:
- 定位漏洞根源：BasicFilter.match() 和 AbstractBasicAuthFilter.match() 未剥离 URI 中的分号路径参数
- 修复 knife4j-core/BasicFilter.java：在正则匹配前截断分号后缀
- 修复 knife4j-gateway-spring-boot-starter/AbstractBasicAuthFilter.java：同上
- 新增安全回归测试 BasicFilterSemicolonBypassTest（11 个用例，全部通过）
- 修复 scripts/test-java.sh：自动检测 JAVA_HOME，解决 CI 环境 javadoc 插件报错
validation:
- `bash scripts/test-java.sh` → BUILD SUCCESS（全部 16 模块）
- 11 个新安全测试 + 2 个已有测试全部通过
next:
- 等待人工 review PR #6
blockers:
- 无
pr: https://github.com/songxychn/knife4j-next/pull/6

## 2026-04-24 00:10 CST
task: TASK-006
agent: codex
branch: codex/TASK-006-sync-master-branch
status: review
summary:
- 根据维护者说明，仓库远端默认分支已切换为 `master`，现有 `build.yml` 中监听 `main` 的 push 触发已过时。
- 已将 `.github/workflows/build.yml` 的 `push.branches` 从 `main` 改为 `master`。
- 已同步更新 `AGENTS.md`、`.agent/AUTONOMY_POLICY.md` 和 `.agent/prompts/openclaw-orchestrator.md` 中关于禁止直接 push 主分支的表述。
validation:
- `rg -n "main|master" .github/workflows AGENTS.md .agent -g '!**/.git/**'` 已确认目标文件中的主分支引用统一为 `master`
- `git diff -- .github/workflows/build.yml AGENTS.md .agent/AUTONOMY_POLICY.md .agent/prompts/openclaw-orchestrator.md` 已确认改动范围仅限预期文件
next:
- 提交、推送并创建 PR
blockers:
- none

## 2026-04-23 00:00 CST
task: TASK-001
agent: codex
branch: codex/TASK-001-agent-docs
status: review
summary:
- 新增 `AGENTS.md` 和初始 `.agent/` 运行文件，用于自治维护。
- 记录了项目意图、任务格式、验证 runbook、审查期望、自治边界和多 agent 协作方式。
validation:
- 纯文档变更，未修改代码路径
next:
- 维护者审查初始自治维护模型
- 后续 agent 可选择 `TASK-002`，或根据仓库现实继续细化队列
blockers:
- none

## 2026-04-24 05:03 UTC
task: TASK-008
agent: coordinator (direct)
branch: codex/TASK-008-boot34-35-compat
status: ready → review
summary:
- springdoc-openapi-jakarta 3.0.1 → 2.8.9
- jakarta-starter/boot3-jakarta-app Boot 4.0.1 → 3.4.5 覆盖去除
- 新增 boot35-jakarta-app smoke 模块（Boot 3.5.0）
validation: ./scripts/test-java.sh → BUILD SUCCESS
next: 维护者审查 PR #10
blockers: none

## TASK-015 — 2026-04-25
- branch: codex/TASK-015-react-swagger-models
- PR: https://github.com/songxychn/knife4j-next/pull/17
- 状态: review
- 验证: npm run build ✓
- 内容: 重写 Schema.tsx，Collapse+Table 展示 components.schemas，支持嵌套字段

## TASK-017 — 2026-04-25
- branch: codex/TASK-017-real-api-data
- PR: https://github.com/songxychn/knife4j-next/pull/18
- 状态: review
- 验证: npm run build ✓
- 内容: 新增 types/swagger.ts + api/knife4jClient.ts，重写 GroupContext 接真实数据，Schema.tsx 消费真实 schemas

## TASK-019 — 2026-04-25
- branch: codex/TASK-019-react-global-param
- PR: https://github.com/songxychn/knife4j-next/pull/20
- 状态: review
- 验证: npm run build ✓（由 claude-worker 执行）
- 内容: GlobalParamContext.tsx + GlobalParam.tsx（表格+新增表单）+ App.tsx 注册

## TASK-020 — 2026-04-25
- branch: codex/TASK-020-react-home
- PR: https://github.com/songxychn/knife4j-next/pull/21
- 状态: review
- 流程: worker → reviewer（发现 paths null safety 问题）→ worker fix → build ✓
- 内容: Home.tsx，API info + method 统计，paths/?? {} guard，info fallback

## 2026-04-25 14:29 CST
task: ad-hoc telegram bot avatar
agent: codex
branch: codex/ad-hoc-telegram-avatar
status: done
summary:
- 基于 `docs-site/public/knife4j-next-mark.svg` 的文档折角与蓝色 `N` 主体，生成 Telegram 机器人头像资产。
- 新增圆角蓝色渐变背景、轻量装饰线和右下角纸飞机徽章，保证小尺寸头像可识别。
validation:
- `sips -g pixelWidth -g pixelHeight docs-site/public/assets/knife4j-next-telegram-bot-avatar.png` 确认为 512x512。
next:
- 如需启用，可将 PNG 上传为 Telegram Bot 头像。
blockers:
- none
