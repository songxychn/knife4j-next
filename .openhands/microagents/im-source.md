# source:im — IM 渠道 Issue 处理规则

## 什么是 source:im

`source:im` label 表示该 issue 来自即时通讯（IM）渠道，如 Telegram、Signal 等。这类 issue 通常由用户反馈触发，经维护者整理后录入 GitHub。

## 处理规则

1. **确认来源**：agent 处理 `source:im` issue 时，必须在 issue 评论中确认已知晓来源，例如：
   ```
   已知晓：本 issue 来自 IM 渠道，按正常流程处理。
   ```

2. **优先级由 coordinator 判断**：`source:im` 本身不代表高优先级或低优先级，coordinator 根据内容和影响面决定优先级。

3. **不得自动关闭**：`source:im` issue 不得由 agent 自动关闭，必须等待维护者确认后方可关闭。

4. **正常工作流**：除上述规则外，`source:im` issue 遵循与其他 issue 相同的 Issue-Driven 工作流（见 coordination.md）。

## 典型场景

- 用户在 Telegram 群反馈某功能异常 → 维护者整理为 GitHub issue 并打上 `source:im`
- agent 拾取任务后，在 issue 评论确认来源，然后按正常流程实现修复
- 修复完成、PR 合并后，由维护者手动关闭 issue
