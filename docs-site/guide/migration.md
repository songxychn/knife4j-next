---
title: 从 upstream 迁移
---

# 从 upstream 迁移到 knife4j-next

本文针对已经在用 `com.github.xiaoymin:knife4j-*` 的项目，说明**切到 `com.baizhukui:knife4j-*` 的最小改动**。

## 核心结论

迁移的最小原子操作只有一件事：**改 Maven 依赖坐标的 `groupId`**。

- Java 包名保留 `com.github.xiaoymin.knife4j.*`，**不变**。
- 所有 `knife4j.*` YAML 配置键，**不变**。
- `/doc.html`、`/v2/api-docs`、`/v3/api-docs` 访问路径，**不变**。
- 全部既有注解（`@ApiOperationSupport`、`@ApiSupport`、`@DynamicParameters` ... ），**不变**。

## 依赖替换（before / after）

### Spring Boot 3.x Jakarta

Before：

```xml
<dependency>
    <groupId>com.github.xiaoymin</groupId>
    <artifactId>knife4j-openapi3-jakarta-spring-boot-starter</artifactId>
    <version>4.5.0</version>
</dependency>
```

After：

```xml
<dependency>
    <groupId>com.baizhukui</groupId>
    <artifactId>knife4j-openapi3-jakarta-spring-boot-starter</artifactId>
    <version>5.0.4</version>
</dependency>
```

### Spring Boot 2.x + springdoc-openapi

Before：

```xml
<dependency>
    <groupId>com.github.xiaoymin</groupId>
    <artifactId>knife4j-openapi3-spring-boot-starter</artifactId>
    <version>4.5.0</version>
</dependency>
```

After：

```xml
<dependency>
    <groupId>com.baizhukui</groupId>
    <artifactId>knife4j-openapi3-spring-boot-starter</artifactId>
    <version>5.0.4</version>
</dependency>
```

### Spring Boot 2.x + Springfox（OpenAPI2）

::: warning 维护模式
`knife4j-openapi2-spring-boot-starter` 处于**兼容维护模式**，不再接收新功能。前端是本仓库 `knife4j-vue3`（Vue 3 + Vite）的构建产物，只接收回归修复与显示层 bug；无法享受 `knife4j-ui-react` 的新特性（SSE 流式响应、allOf/oneOf 渲染、二进制下载修复等）。

若需使用新 UI 特性，请迁移到 OAS3 starter，参考 [从 Springfox 迁移到 OpenAPI3](./springfox-migration)。
:::

Before：

```xml
<dependency>
    <groupId>com.github.xiaoymin</groupId>
    <artifactId>knife4j-openapi2-spring-boot-starter</artifactId>
    <version>4.5.0</version>
</dependency>
```

After：

```xml
<dependency>
    <groupId>com.baizhukui</groupId>
    <artifactId>knife4j-openapi2-spring-boot-starter</artifactId>
    <version>5.0.4</version>
</dependency>
```

### 网关 / 聚合 / WebFlux 对应坐标

| upstream | knife4j-next |
| --- | --- |
| `com.github.xiaoymin:knife4j-gateway-spring-boot-starter` | `com.baizhukui:knife4j-gateway-spring-boot-starter` |
| `com.github.xiaoymin:knife4j-aggregation-spring-boot-starter` | `com.baizhukui:knife4j-aggregation-spring-boot-starter` |
| `com.github.xiaoymin:knife4j-aggregation-jakarta-spring-boot-starter` | `com.baizhukui:knife4j-aggregation-jakarta-spring-boot-starter` |
| `com.github.xiaoymin:knife4j-openapi3-webflux-spring-boot-starter` | `com.baizhukui:knife4j-openapi3-webflux-spring-boot-starter`（见 [WebFlux](./webflux)） |
| `com.github.xiaoymin:knife4j-openapi3-webflux-jakarta-spring-boot-starter` | `com.baizhukui:knife4j-openapi3-webflux-jakarta-spring-boot-starter`（见 [WebFlux](./webflux)） |

## 业务代码不用动

下面这些在 upstream 文档中会出现的代码，**迁到 knife4j-next 后完全不用改**：

```java
// 注解 import 不变
import com.github.xiaoymin.knife4j.annotations.ApiOperationSupport;
import com.github.xiaoymin.knife4j.annotations.ApiSupport;
import com.github.xiaoymin.knife4j.annotations.DynamicParameters;
```

```yaml
# 配置键不变
knife4j:
  enable: true
  production: false
  setting:
    language: zh_cn
  basic:
    enable: true
    username: admin
    password: secret
```

::: warning 部分注解只在 openapi2-starter 可用
`@DynamicParameters`、`@DynamicResponseParameters`、`@ApiOperationSupport(ignoreParameters/includeParameters)` 等 **Springfox 专属** 的 Plugin 体系只在 `knife4j-openapi2-spring-boot-starter` 生效。
迁到 `openapi3` 系列 starter 时这些注解会被编译器接受但 **运行时不处理**。这是 upstream v4.0 起官方弃用的决策，非本 fork 变更。详见 [注解速查](../reference/annotations)。
:::

## 迁移步骤

1. **更新 Maven 依赖坐标**：全部 `com.github.xiaoymin` → `com.baizhukui`。
2. **确认版本**：升到 `5.0.4`（当前稳定补丁版本）。
3. **刷新依赖**：`mvn -U clean verify` 或 `mvn dependency:tree | grep knife4j` 检查无残留旧坐标。
4. **启动验证**：访问 `/doc.html`，确认能看到接口列表。
5. **如切到 OpenAPI3 系列 starter**：额外检查是否用了 Springfox 专属注解（`@DynamicParameters` 等），必要时替换为 DTO 实体类方式（参考 [注解速查](../reference/annotations)）。

## 验证命令

```bash
# 确认依赖里全部是 com.baizhukui
mvn dependency:tree -Dincludes=com.baizhukui:knife4j-*,com.github.xiaoymin:knife4j-*

# 启动并抓一下 doc.html
mvn spring-boot:run &
curl -I http://localhost:8080/doc.html
curl http://localhost:8080/v3/api-docs | head

# 生产环境保护是否生效
curl -I http://localhost:8080/doc.html   # 403 即正确
```

## 迁移后验收清单

- [ ] `mvn dependency:tree` 输出里没有 `com.github.xiaoymin:knife4j-*` 残留
- [ ] 应用成功启动，`/doc.html` 可访问
- [ ] `/v3/api-docs`（或 `/v2/api-docs`）返回正确的 OpenAPI JSON
- [ ] 业务代码**没有**改动，只有 `pom.xml` 的 groupId 改了
- [ ] 如果启用了 `knife4j.production` 或 `knife4j.basic`，生产发布前再做一次黑盒验证
- [ ] 如果依赖新 React 前端的 UI 行为，已阅读 [新前端覆盖范围](../roadmap/#react-ui-coverage)，确认 `enable-debug`、`enable-search`、`enable-version` 等配置是否还是你预期的效果

## 回滚策略

`com.github.xiaoymin:knife4j-*` 仍然在 Maven Central，随时可以回退：

```xml
<!-- 回滚 -->
<dependency>
    <groupId>com.github.xiaoymin</groupId>
    <artifactId>knife4j-openapi3-jakarta-spring-boot-starter</artifactId>
    <version>4.5.0</version>
</dependency>
```

由于业务代码未改，回滚成本等于依赖替换成本。

## 常见迁移问题

- **找不到 `com.baizhukui` 坐标**：刷新 Maven 中央仓库镜像；企业私服需要手动同步（Central 已发布）。
- **doc.html 404**：见 [FAQ / SpringBoot 访问 doc.html 404](./faq#doc-html-404)。
- **`enable-version` / `enable-debug` 等开关对新前端无效**：见 [FAQ / 为什么我的 knife4j.setting 配置不生效](./faq#react-setting-not-effective)。
- **Gateway context-path 下聚合出错**：升级到 `5.0.4` 即可包含该修复（[#954](https://github.com/xiaoymin/knife4j/issues/954)）。
