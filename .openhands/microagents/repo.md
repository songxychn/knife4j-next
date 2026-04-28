# knife4j-next — 项目概览

## 项目使命

维护 `knife4j` 社区 fork，保持 `doc.html` 体验稳定可用，同时通过 `knife4j-front/knife4j-ui-react` 增量推进下一代前端。不做一次性重写，不破坏向后兼容。

## 主要区域

| 区域 | 说明 |
|------|------|
| `knife4j/` | Java 多模块主工程，影响下游 starter 和 UI webjar |
| `knife4j-front/knife4j-core` | TypeScript 解析核心，适合窄范围自治任务 |
| `knife4j-front/knife4j-ui-react` | 下一代 UI 探索区，改动必须保持增量 |
| `knife4j-doc/` | 文档站，适合清理、迁移说明和 release note |

## 当前优先级

1. 保持 `4.x` 对现有用户可用、稳定、可预期
2. 修复 Spring Boot 2.7/3.x 与 Spring Framework 5.3/6.x 兼容性问题
3. 降低聚合、UI 交付和 starter 行为中的回归风险
4. 让发布流程更可重复，减少人工操作依赖
5. 通过 `knife4j-front` 增量推进下一代前端

## 验证命令

| 场景 | 命令 |
|------|------|
| Java 快速编译 | `./scripts/test-java.sh` |
| Java 单模块测试 | `cd knife4j && mvn -pl <module> test` |
| front-core 测试 | `./scripts/test-front-core.sh` |
| ui-react 构建 | `./scripts/test-front-core.sh` |
| TOML 合法性 | `python3 -c "import tomllib; tomllib.load(open('.openhands/config.toml','rb'))"` |

## 安全红线

- **不得** 直接 push 到 `master`
- **不得** 修改 `release/*` 分支
- **不得** 修改 Maven 坐标或默认兼容性承诺
- **不得** 发布 release 或代表维护者合并 PR
- **不得** 删除模块、大目录或重要历史代码路径

## 双写纪律

过渡期内，`.openhands/` 与 `.agent/` 的内容需保持一致。当任一侧有规则更新时，coordinator 必须在同一 PR 内同步到另一侧，否则 reviewer 拒绝合并。
