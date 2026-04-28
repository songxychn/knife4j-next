# OpenHands 并行验证计划

_Phase 5 - OpenClaw → OpenHands 迁移_

## 目标

在真实任务上对比 OpenClaw（当前）和 OpenHands（候选）的执行效果，为最终切换提供数据支撑。

## 候选 Issue

选取 3 个低风险任务作为对照样本，优先 `area:docs` 或 `area:ui-react`：

| # | Issue | 标签 | 理由 |
|---|-------|------|------|
| 1 | [#115 ui-react: 目标的 description 不展示](https://github.com/songxychn/knife4j-next/issues/115) | area:ui-react | 纯前端 bug，范围明确，无 Java 依赖 |
| 2 | [#150 ui-react: 字段约束信息 tooltip 展示](https://github.com/songxychn/knife4j-next/issues/150) | area:ui-react | 纯前端新功能，改动集中在单个组件 |
| 3 | [#165 TASK-OH-007: 并行验证对照 issue（文档）](https://github.com/songxychn/knife4j-next/issues/165) | area:repo | 纯文档任务，无代码风险，适合验证文档类任务处理能力 |

## 执行方案

每个 issue 各执行两次：

- **Run A**：OpenClaw（当前 coordinator + Claude Code worker）
- **Run B**：OpenHands（GUI 模式，相同 issue 描述）

两次执行独立进行，不共享中间产物。

## 对比维度

| 维度 | 说明 | 采集方式 |
|------|------|----------|
| 任务完成率 | PR 是否成功创建且 CI 全绿 | gh pr checks |
| 平均执行时间 | 从拾取 issue 到创建 PR 的耗时（分钟） | 手动记录时间戳 |
| LLM 消耗 | input/output token 数 | OpenClaw: session log；OpenHands: GUI 统计 |
| 环境准备失败率 | 沙箱启动失败、依赖安装失败等 | 执行日志 |
| PR 质量 | reviewer 主观评分（1-5 分） | 人工 review |

## 记录表格

| Issue | Run | 完成 | 耗时(min) | Input Token | Output Token | 环境失败 | PR 质量(1-5) | 备注 |
|-------|-----|------|-----------|-------------|--------------|----------|--------------|------|
| #115  | OpenClaw   | - | - | - | - | - | - | |
| #115  | OpenHands  | - | - | - | - | - | - | |
| #150  | OpenClaw   | - | - | - | - | - | - | |
| #150  | OpenHands  | - | - | - | - | - | - | |
| #165  | OpenClaw   | - | - | - | - | - | - | |
| #165  | OpenHands  | - | - | - | - | - | - | |

## 最终切换判定标准

满足以下全部条件时，可将默认执行引擎切换为 OpenHands：

1. **完成率**：OpenHands 完成率 ≥ OpenClaw 完成率 - 10%
2. **执行时间**：OpenHands 平均耗时 ≤ OpenClaw 平均耗时 × 1.5
3. **稳定性**：连续 3 个任务无环境准备失败

未达标时继续使用 OpenClaw，每月重新评估一次。

## 状态

- [ ] Run A（OpenClaw）执行中
- [ ] Run B（OpenHands）待启动
- [ ] 数据汇总
- [ ] 切换决策
