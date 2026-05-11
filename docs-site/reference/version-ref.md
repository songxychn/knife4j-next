---
title: 版本对照
---

# 版本对照

## knife4j-next 版本 vs Spring Boot 版本

| knife4j-next 版本 | Spring Boot 2.x | Spring Boot 3.x | Spring Boot 4.x | 说明 |
| --- | --- | --- | --- | --- |
| `5.0.1` | ✅ 2.7.18 | ✅ 3.4.0 ~ 3.5.0 | ✅ 4.0.6 | 当前版本，补丁修复版本 |
| `5.0.0` | ✅ 2.7.18 | ✅ 3.4.0 ~ 3.5.0 | ❌ | 首个正式稳定版本 |

> knife4j-next 从 `5.0.0` 起采用独立 [SemVer](https://semver.org/lang/zh-CN/) 版本号，与上游 knife4j 版本号无关。

## 核心依赖版本

以下为 `knife4j-next 5.0.1` 内部管理的依赖版本，用户一般不需要手动指定。

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

### Boot 4.x（Jakarta）线

| 依赖 | 版本 |
| --- | --- |
| Spring Boot | `4.0.6` |
| springdoc-openapi | `3.0.3` |
| Swagger v3 models | `2.2.47` |
| Servlet Jakarta API | `6.1.0` |

> smoke-tests 中 `boot4-jakarta-app` 使用 Boot `4.0.6`，通过验证。

### 其他共享依赖

| 依赖 | 版本 |
| --- | --- |
| Java 最低版本 | `1.8`（非 Jakarta）；`17`（Jakarta / Boot4） |
| SLF4J | `2.0.16` |
| Hutool | `5.8.34` |
| Gson | `2.11.0` |
| Javassist | `3.30.2-GA` |
| Lombok | `1.18.36` |

## Upstream 版本对照

| upstream 版本 | knife4j-next 版本 | 说明 |
| --- | --- | --- |
| `4.6.0` | `5.0.1` | 当前版本：包含全部 fork 安全修复 + Boot 3.4/3.5/4.0 兼容 + React UI + 补丁修复 |
| `4.6.0` | `5.0.0` | 首个正式稳定版本 |

## 如何确认你项目中的实际版本

```bash
mvn dependency:tree -Dincludes=com.baizhukui
mvn dependency:tree -Dincludes=org.springdoc
```

如果 springdoc 版本与上表不一致，说明你的项目中有其他依赖覆盖了版本管理。请检查是否有 BOM 或父 POM 引入了不同版本的 springdoc。
