# 路线图

## 当前阶段

### A 线：维护与兼容

- 修复 Java starter 模块中的回归。
- 增强 Spring Boot 2.x 和 3.x 入口路径的 smoke 覆盖。
- 保持发布验证可靠。

### B 线：文档与迁移清晰度

- 替换会让用户误解 fork 归属的旧 upstream 表述。
- 改进 `groupId` 变化和 starter 组合支持说明。
- 明确 release note 和已知限制。

### C 线：前端基础

- 继续改进 `knife4j-front/knife4j-core` 的解析核心。
- UI 工作保持增量和可验证。
- 没有强回归保护前，避免大范围 UI 重写。

## 后续阶段

- 为代表性示例应用增加更强集成 smoke test。
- 完善 fork 自己的文档站叙事和版本体系。
- 建立更结构化的 issue triage 和 release candidate 流程。

## 暂未批准

- 自动发布构件
- 破坏性配置变更
- 大规模删除模块
- 完整前端架构转向
