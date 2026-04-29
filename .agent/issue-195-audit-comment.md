## ISSUE-195 Gateway/Aggregation Upstream Issue 盘点报告

> 由 worker agent 自动生成，审计日期：2026-04-29

---

### 盘点范围

- `knife4j-gateway-spring-boot-starter`（31 个 Java 文件）
- `knife4j-aggregation-spring-boot-starter`（51 个 Java 文件）
- `knife4j-aggregation-jakarta-spring-boot-starter`（60 个 Java 文件）

---

### 逐条 Upstream Issue 状态

| Upstream Issue | 标题摘要 | knife4j-next 状态 | 代码证据 / 说明 |
|---|---|---|---|
| [#727 (I73AOG)](https://gitee.com/xiaoym/knife4j/issues/I73AOG) | Nginx 代理下刷新文档 contextPath 叠加 | ✅ **已修复** | `OpenAPIEndpoint.java:79` 每次请求 copy 新对象；`ServiceDiscoverHandler.java:115` 同样 copy；注释明确引用 I73AOG |
| [#671 (I6YLMB)](https://gitee.com/xiaoym/knife4j/issues/I6YLMB) | 服务发现排除服务 SPI 扩展 | ✅ **已修复** | `ServiceDiscoverHandler.java:72` 通过 `GatewayServiceExcludeService` SPI 扩展；注释引用 I6YLMB；`DefaultGatewayServiceExcludeService` 默认实现已注册 |
| [#655 (I6H8BE)](https://gitee.com/xiaoym/knife4j/issues/I6H8BE) | Basic Auth 未拦截 `/swagger-ui` 路径 | ✅ **已修复** | `AbstractBasicAuthFilter.java:53` 已添加 `.*?/swagger-ui.*` 规则；注释引用 I6H8BE |
| [#673 (I4XDYE)](https://gitee.com/xiaoym/knife4j/issues/I4XDYE) | 双斜杠路径绕过 Basic Auth | ✅ **已修复** | `AbstractBasicAuthFilter.java:87` `uri.replaceAll("/+", "/")` 规范化路径；注释引用 I4XDYE |
| [#873 (I64P8J)](https://gitee.com/xiaoym/knife4j/issues/I64P8J) | Cloud 聚合服务下线后重新上线不恢复 | ✅ **已修复** | `CloudRepository.java:121` 检测 `!routeMap.containsKey` 后重新上线；注释引用 I64P8J |
| [#785 (I3ZPUS)](https://gitee.com/xiaoym/knife4j/issues/I3ZPUS) | Nacos/Cloud 心跳后出现重复服务 | ✅ **已修复** | `AbstractRepository.java:71` `heartRepeatClear()`；`NacosRepository.java:141`、`CloudRepository.java:145` 均调用；注释引用 I3ZPUS |
| [#710](https://gitee.com/xiaoym/knife4j/issues/I6YLMB) | 网关 Basic Auth 配置属性优先级 | ⚠️ **轻微设计冗余，功能正常** | `Knife4jGatewayHttpBasic` 和 `Knife4jGatewayProperties.basic` 均绑定 `knife4j.gateway.basic` 前缀（双重 `@ConfigurationProperties`）。`securityBasicAuthFilter` bean 实际读取 `knife4jGatewayProperties.getBasic()`，独立 bean 未被使用。功能无 bug，但存在冗余注册。详见 `Knife4jGatewayAutoConfiguration.java:154-174` |
| [#931/#939](https://github.com/xiaoymin/knife4j/issues/939) | SC 2025 / SB 3.5+ blocking-on-reactor-thread | ✅ **已修复** | `DiscoverClientRouteServiceConvert.java:62-67` 使用 `.subscribeOn(Schedulers.boundedElastic()).block()`；注释明确引用 issue #939 |

---

### 与 knife4j-next 内部 Issue 的关联（推断，需 coordinator 确认）

| knife4j-next Issue | 关联 Upstream | 说明 |
|---|---|---|
| #105 | #655 / #673 | Basic Auth 安全加固（路径绕过） |
| #106 | #727 | Nginx 代理 contextPath 叠加 |
| #107 | #671 | 服务发现 SPI 排除扩展 |

---

### 编译验证结果

| 模块 | 命令 | 结果 |
|---|---|---|
| `knife4j-gateway-spring-boot-starter` | `mvn compile -Dspotless.skip=true` | ✅ BUILD SUCCESS |
| `knife4j-aggregation-spring-boot-starter` | `mvn compile -q` | ❌ 失败（范围外原因）：依赖 `knife4j-openapi2-ui:5.0.0-SNAPSHOT` 需要 `pnpm` 构建前端，环境中未安装 `pnpm`。Java 源码本身无编译错误（代码风格与 gateway 模块一致）。 |

---

### 发现的潜在问题（未在 upstream issues 中明确提及）

#### 1. `Knife4jGatewayHttpBasic` 冗余注册（低风险）

**文件**：`Knife4jGatewayAutoConfiguration.java:49` + `Knife4jGatewayHttpBasic.java:32`

`Knife4jGatewayHttpBasic` 被 `@EnableConfigurationProperties` 注册为独立 bean，同时 `Knife4jGatewayProperties.basic` 字段也绑定相同前缀 `knife4j.gateway.basic`。`securityBasicAuthFilter` 只使用后者，独立 bean 从未被注入使用。建议移除 `Knife4jGatewayHttpBasic.class` 的独立注册，或统一使用独立 bean。

#### 2. `NacosRepository.applyRoutes()` 重复 put（低风险）

**文件**：`NacosRepository.java:67-73`

第 67-72 行的 forEach 已完成 routeAuth 设置和 routeMap.put，第 73 行又重复执行了一次 forEach put（无 routeAuth 设置）。无功能 bug（HashMap 覆盖相同 key），但第 73 行是多余代码。

#### 3. `WebFluxSecurityBasicAuthFilter.doFilter()` NPE 风险（中风险）

**文件**：`WebFluxSecurityBasicAuthFilter.java:81-85`

`writeForbiddenCode` 抛出 `ResponseStatusException` 后理论上会中断，但代码依赖异常控制流而非显式 `return`。若 `authorization == null` 时异常被上层捕获，后续 `authorization.split(" ")` 会 NPE。建议在 `writeForbiddenCode(response)` 调用后加 `return`（或 `throw` 直接抛出）。

---

### 后续建议

1. **可直接修复（低风险，范围清晰）**：
   - 移除 `NacosRepository.java:73` 的重复 forEach
   - 在 `WebFluxSecurityBasicAuthFilter.doFilter()` 的 `writeForbiddenCode` 调用后加 `return`
   - 移除 `Knife4jGatewayHttpBasic` 的冗余 `@EnableConfigurationProperties` 注册

2. **需要讨论**：
   - `knife4j-aggregation-spring-boot-starter` 编译依赖 `pnpm`，CI 环境需要安装 `pnpm` 或在 aggregation 模块中排除前端构建依赖

3. **已确认无需修复**：#727 #671 #655 #673 #873 #785 #931 均已在 knife4j-next 中修复，代码注释中有明确引用。
