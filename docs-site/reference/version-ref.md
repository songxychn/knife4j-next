---
title: 版本对照
---

# 版本对照

## knife4j-next 版本 vs Spring Boot 版本

| knife4j-next 版本 | Spring Boot 2.x | Spring Boot 3.x | Spring Boot 4.x | 说明 |
| --- | --- | --- | --- | --- |
| `5.0.13` | ✅ 2.7.18 | ✅ 3.4.0 ~ 3.5.0 | ✅ 4.0.6 | 当前版本，补丁修复版本 |
| `5.0.12` | ✅ 2.7.18 | ✅ 3.4.0 ~ 3.5.0 | ✅ 4.0.6 | 补丁修复版本 |
| `5.0.11` | ✅ 2.7.18 | ✅ 3.4.0 ~ 3.5.0 | ✅ 4.0.6 | 补丁修复版本 |
| `5.0.10` | ✅ 2.7.18 | ✅ 3.4.0 ~ 3.5.0 | ✅ 4.0.6 | 补丁修复版本 |
| `5.0.9` | ✅ 2.7.18 | ✅ 3.4.0 ~ 3.5.0 | ✅ 4.0.6 | 补丁修复版本 |
| `5.0.8` | ✅ 2.7.18 | ✅ 3.4.0 ~ 3.5.0 | ✅ 4.0.6 | 补丁修复版本 |
| `5.0.7` | ✅ 2.7.18 | ✅ 3.4.0 ~ 3.5.0 | ✅ 4.0.6 | 补丁修复版本 |
| `5.0.6` | ✅ 2.7.18 | ✅ 3.4.0 ~ 3.5.0 | ✅ 4.0.6 | 补丁修复版本 |
| `5.0.5` | ✅ 2.7.18 | ✅ 3.4.0 ~ 3.5.0 | ✅ 4.0.6 | 补丁修复版本 |
| `5.0.4` | ✅ 2.7.18 | ✅ 3.4.0 ~ 3.5.0 | ✅ 4.0.6 | 补丁修复版本 |
| `5.0.3` | ✅ 2.7.18 | ✅ 3.4.0 ~ 3.5.0 | ✅ 4.0.6 | 补丁修复版本 |
| `5.0.2` | ✅ 2.7.18 | ✅ 3.4.0 ~ 3.5.0 | ✅ 4.0.6 | 补丁修复版本 |
| `5.0.1` | ✅ 2.7.18 | ✅ 3.4.0 ~ 3.5.0 | ✅ 4.0.6 | 补丁修复版本 |
| `5.0.0` | ✅ 2.7.18 | ✅ 3.4.0 ~ 3.5.0 | ❌ | 首个正式稳定版本 |

> knife4j-next 从 `5.0.0` 起采用独立 [SemVer](https://semver.org/lang/zh-CN/) 版本号，与上游 knife4j 版本号无关。
> `5.0.13` 包含 Boot4 WebMVC starter 与 Boot4 Gateway starter，可直接使用 `com.baizhukui:knife4j-openapi3-boot4-spring-boot-starter:5.0.13` 和 `com.baizhukui:knife4j-gateway-boot4-spring-boot-starter:5.0.13`。

## 核心依赖版本

以下为 `knife4j-next 5.0.13` 内部管理的依赖版本，用户一般不需要手动指定。

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
| Swagger v3 Jakarta models | `2.2.47` |
| Servlet Jakarta API | `6.1.0` |

> smoke-tests 中 `boot3-jakarta-app` 使用 Boot `3.4.5`，`boot35-jakarta-app` 使用 Boot `3.5.0`，均通过验证。

### Boot 4.x（Jakarta）线

| 依赖 | 版本 |
| --- | --- |
| Spring Boot | `4.0.6` |
| Spring Cloud | `2025.1.1`（Gateway 5.x） |
| springdoc-openapi | `3.0.3` |
| Swagger v3 models | `2.2.47` |
| Servlet Jakarta API | `6.1.0` |

> smoke-tests 中 `boot4-jakarta-app` 与 `boot4-gateway-app` 使用 Boot `4.0.6`，通过验证。

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
| `4.5.0`（上游 Maven Central 最后发布版本） | `5.0.13` | 当前版本：包含全部 fork 安全修复 + Boot 3.4/3.5/4.0 兼容 + Boot4 Gateway 聚合 + React UI + 补丁修复 |
| `4.5.0` | `5.0.12` | 补丁修复版本 |
| `4.5.0` | `5.0.11` | 补丁修复版本 |
| `4.5.0` | `5.0.10` | 补丁修复版本 |
| `4.5.0` | `5.0.9` | 补丁修复版本 |
| `4.5.0` | `5.0.8` | 补丁修复版本 |
| `4.5.0` | `5.0.7` | 补丁修复版本 |
| `4.5.0` | `5.0.6` | 补丁修复版本 |
| `4.5.0` | `5.0.5` | 补丁修复版本 |
| `4.5.0` | `5.0.4` | 补丁修复版本 |
| `4.5.0` | `5.0.3` | 补丁修复版本 |
| `4.5.0` | `5.0.2` | 补丁修复版本 |
| `4.5.0` | `5.0.1` | 补丁修复版本 |
| `4.5.0` | `5.0.0` | 首个正式稳定版本 |

## 如何确认你项目中的实际版本

```bash
mvn dependency:tree -Dincludes=com.baizhukui
mvn dependency:tree -Dincludes=org.springdoc
mvn dependency:tree -Dincludes=org.apache.commons:commons-lang3
```

如果 springdoc 版本与上表不一致，说明你的项目中有其他依赖覆盖了版本管理。请检查是否有 BOM 或父 POM 引入了不同版本的 springdoc。

如果安全扫描提示 `CVE-2025-48924`，重点确认 `commons-lang3` 是否低于 `3.18.0`。使用 Spring Boot parent 或
Spring Boot BOM 的应用可能会把 starter 传递声明的 `commons-lang3` 版本重新管理回 Boot 自带版本；这种情况下需要在应用侧
`dependencyManagement` 中显式覆盖到 `3.20.0` 或更高版本。
