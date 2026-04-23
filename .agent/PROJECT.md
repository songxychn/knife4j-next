# 项目意图

## 这个仓库是什么

`knife4j-next` 是 `xiaoymin/knife4j` 的社区维护 fork。

它存在的目的，是为仍依赖 `doc.html` 体验和相关 starter 模块的用户提供更可预期的维护路径。

## 当前优先级

1. 保持 `4.x` 对现有用户可用、稳定、可预期。
2. 修复 Spring Boot 2.7 / 3.x 与 Spring Framework 5.3 / 6.x 相关兼容性问题。
3. 降低聚合、UI 交付和 starter 行为中的回归风险。
4. 让发布流程更可重复，减少对人工临场操作的依赖。
5. 通过 `knife4j-front` 增量推进下一代前端，而不是一次性重写。

## 自治 Agent 的非目标

- 不要尝试完整产品重设计。
- 未经明确批准，不要替换当前 `doc.html` 兼容约定。
- 不要一次性迁移到 React。
- 不要为了代码优雅牺牲向后兼容。

## 主要区域

### `knife4j`

Java 多模块主工程。这里是最关键的维护面，因为它影响下游用户使用的 starter 和 UI webjar。

### `knife4j-front/knife4j-core`

TypeScript 解析核心。只要测试能证明行为，适合做窄范围自治任务。

### `knife4j-doc`

文档站。适合自治清理、迁移说明和 release note 改进，前提是文档构建通过。

### `knife4j-front/knife4j-ui-react`

下一代 UI 探索区。Agent 在这里的改动必须保持增量，不要隐含产品承诺。

## 稳定性优先

当一个任务有多种解决方式时，优先选择：

1. 保留现有运行时行为
2. 增加测试覆盖或诊断能力
3. 回滚路径简单

## 状态纪律

重要状态不能只存在于 issue 评论、PR 评论或聊天记录里。Agent 必须把持久状态写回 `.agent/`。
