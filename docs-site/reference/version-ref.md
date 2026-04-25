---
title: 版本对照
---

# 版本对照

## knife4j-next 版本 vs Spring Boot 版本

| knife4j-next 版本 | Spring Boot 2.x | Spring Boot 3.x | 说明 |
| --- | --- | --- | --- |
| `4.6.0.3` | ✅ 2.7.18 | ✅ 3.4.0 ~ 3.5.0 | 当前版本，含 Boot 3.4/3.5 兼容修复 |
| `4.6.0.2` | ✅ 2.7.18 | ✅ 3.4.0 | Gateway context-path 修复 |
| `4.6.0.1` | ✅ 2.7.18 | ✅ 3.4.0 | Basic 认证绕过安全修复 |
| `4.6.0` | ✅ 2.7.18 | ⚠️ 3.4.0（有已知问题） | 基于 upstream `4.6.0` |

> knife4j-next 版本号策略：`<upstream版本>.<fork补丁号>`。例如 `4.6.0.3` = upstream `4.6.0` + 3 个 fork 专有补丁。

## 核心依赖版本

以下为 `knife4j-next 4.6.0.3` 内部管理的依赖版本，用户一般不需要手动指定。

### Boot 2.x（非 Jakarta）线

| 依赖 | 版本 |
| --- | --- |
| Spring Framework | `5.3.31` |
| Spring Boot | `2.7.18` |
| Springfox | `2.10.5` |
| springdoc-openapi | `1.8.0` |
| Swagger 2 models | `1.6.14` |
| Servlet API | `4.0.1` |

### Boot 3.x（Jakarta）线

| 依赖 | 版本 |
| --- | --- |
| Spring Framework | `6.2.0` |
| Spring Boot | `3.4.0` |
| springdoc-openapi Jakarta | `2.8.9` |
| Swagger v3 models | `2.2.26` |
| Servlet Jakarta API | `6.1.0` |

> smoke-tests 中 `boot3-jakarta-app` 使用 Boot `3.4.5`，`boot35-jakarta-app` 使用 Boot `3.5.0`，均通过验证。

### 其他共享依赖

| 依赖 | 版本 |
| --- | --- |
| Java 最低版本 | `1.8`（非 Jakarta）；`17`（Jakarta） |
| SLF4J | `2.0.16` |
| Hutool | `5.8.34` |
| Gson | `2.11.0` |
| Javassist | `3.30.2-GA` |
| Lombok | `1.18.36` |

## Upstream 版本对照

| upstream 版本 | fork 基线 | fork 额外修复 |
| --- | --- | --- |
| `4.6.0` | `4.6.0` | — |
| `4.6.0` | `4.6.0.1` | [#886](https://github.com/xiaoymin/knife4j/issues/886) Basic 认证绕过 |
| `4.6.0` | `4.6.0.2` | [#954](https://github.com/xiaoymin/knife4j/issues/954) Gateway context-path |
| `4.6.0` | `4.6.0.3` | [#874](https://github.com/xiaoymin/knife4j/issues/874) [#913](https://github.com/xiaoymin/knife4j/issues/913) Boot 3.4/3.5 兼容 + React UI 集成 |

## 如何确认你项目中的实际版本

```bash
mvn dependency:tree -Dincludes=com.baizhukui
mvn dependency:tree -Dincludes=org.springdoc
```

如果 springdoc 版本与上表不一致，说明你的项目中有其他依赖覆盖了版本管理。请检查是否有 BOM 或父 POM 引入了不同版本的 springdoc。

