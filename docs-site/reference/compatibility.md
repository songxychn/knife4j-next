# 兼容矩阵

这份矩阵先描述的是**当前工程依赖基线**，主要依据 `knife4j/pom.xml` 整理，不等于每一种组合都已经完成全量回归测试。

## 当前基线

| 维度 | 当前基线 |
| --- | --- |
| 项目版本 | `4.6.0.3` |
| Java 基线 | `1.8` |
| Spring Framework 5.x | `5.3.31` |
| Spring Boot 2.x | `2.7.18` |
| Spring Framework 6.x | `6.2.0` |
| Spring Boot 3.x | `3.4.x / 3.5.x` |
| Springfox | `2.10.5` |
| springdoc-openapi | `1.8.0` |
| springdoc-openapi Jakarta | `2.8.9` |

## 当前站点建议怎么表达兼容性

### 作为文档承诺

- `Spring Boot 2.7.x`：优先维护
- `Spring Boot 3.4.x`：优先维护
- `doc.html`：继续作为默认访问入口
- `Gateway / Aggregation`：作为重点回归场景

### 不要过度承诺

- 不要在首页直接写“全面兼容所有 3.x / 4.x”
- 不要把尚未跑通的组合写成已支持
- 不要把实验性前端路线混进兼容性承诺

## 后续应该补的验证矩阵

| 方向 | 建议动作 |
| --- | --- |
| Boot 2.7 | 跑 starter 冒烟示例 |
| Boot 3.4 / 3.5 | 跑 Jakarta starter 与静态资源访问 |
| WebFlux | 验证 `openapi3-webflux` 两条线 |
| Gateway | 覆盖路由聚合、上下文路径、鉴权 |
| 文档访问 | 验证 `doc.html`、`v2/api-docs`、`v3/api-docs` |

## 这个页面的定位

这个页面不是在“炫技”，而是在帮助用户回答两个现实问题：

1. 我现在能不能迁过来？
2. 迁过来之后我最该先验证什么？
