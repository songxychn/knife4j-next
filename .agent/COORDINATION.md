# 独立审查与可选多 Agent 协作

默认交付单元是 **主 agent + 独立 reviewer**。主 agent 负责端到端交付；reviewer 是必选门禁。worker 只在并行、文件所有权隔离或上下文控制有明确收益时使用。

## 独立性的最低条件

Reviewer 必须同时满足：

- 使用当前实现上下文之外的独立上下文；不能由主 agent 自我复盘代替
- 自行读取主 issue / PR、冻结契约和实际 `git diff` / `git show`；不能只看实现者摘要
- 明确记录所审查的 base 与 head SHA，结论只对该 head 有效
- 审查阶段只读，不直接修改实现；修复交回主 agent

维护者人工 review 满足独立性，可以替代 reviewer agent。

## 默认审查流程

1. 主 agent 在 issue / PR 冻结支持版本、范围内对象、外部行为、非目标、验证命令与完成条件。
2. 主 agent 完成实现和本地验证后提交变更，把 base/head SHA、冻结契约、changed files、验证证据和已知风险交给 reviewer。
3. Reviewer 对当前 head 做一轮全量审查，并返回 findings、验证缺口、范围外建议和结论。
4. 主 agent 一次性把 finding 归为 `当前契约缺陷 / 无效或拒绝 / 范围外后续`；采纳项批量修复、验证和回复。
5. 若有修复 push，reviewer 只对列出的 finding、修复提交和回归证据做一轮定向复核。
6. 当前 head 的本地验证、独立审查和 PR CI 全绿后，才能标 `status:review`。

默认审查预算是 **一轮全量审查 + 一轮定向复核**。出现第三轮审查、新规范版本、新模块、新产品承诺、核心实现实质改写或两种处置会产生不同外部行为时，停止自动追评并请维护者决定。

任意新 push 都使旧 SHA 的审查与 CI 结论失效。Review 修复使用普通追加提交，不为每条 finding amend / force-push。

## Reviewer 输入输出

独立 reviewer 使用 `.agent/prompts/reviewer.md`。主 agent 必须补全当次 base/head SHA、冻结契约、变更范围、验证证据、已知风险和 `full | focused` 模式；focused 模式还要列明待复核 finding 与修复提交。

Reviewer 的 `block/high/medium` finding 必须给出文件、行号或可定位证据、影响和契约关联。范围外能力只进入 `scope_followups`，不能升级为当前 PR 必修 finding。

## 可选 worker

Worker 适合并行探索或实现会挤占主上下文、且能给出不重叠文件所有权的任务。主 agent 直接发送下面的任务契约即可，不需要单独角色提示词：

```text
Task:
Allowed files or modules:
Disallowed files or modules:
Expected behavior change:
Validation command:
Done condition:
Extra constraints:
```

Worker 只改分配范围，运行指定验证，不改 issue label、不写最终 PR 叙事、不回滚别人的改动。返回 changed files、事实摘要、验证结果、风险和 follow-up；需要越界时停止并报告。
