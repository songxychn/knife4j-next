# knife4j Java 主工程

本目录是 `knife4j-next` 的 Java 多模块主工程，负责构建用户实际引入的 starter、UI webjar、聚合组件和依赖管理。

`knife4j-next` 是 `xiaoymin/knife4j` 的社区维护 fork。当前发布坐标使用 `com.baizhukui`，Java 包名仍保留 `com.github.xiaoymin.knife4j.*`，以维持既有用户代码兼容。

## 当前坐标

已发布稳定版本：

```xml
<dependency>
    <groupId>com.baizhukui</groupId>
    <artifactId>knife4j-openapi3-jakarta-spring-boot-starter</artifactId>
    <version>5.0.3</version>
</dependency>
```

源码分支中的根 POM 可能进入下一轮 `SNAPSHOT` 开发状态；对外接入示例以已发布版本为准。

## 模块概览

| 模块 | 说明 |
| --- | --- |
| `knife4j-core` | 核心增强逻辑、配置解析、vendor extension 与 OpenAPI 自定义器 |
| `knife4j-dependencies` | BOM / dependencyManagement |
| `knife4j-openapi2-ui` | OpenAPI2 / Springfox UI webjar，打包 `knife4j-vue3` 构建产物 |
| `knife4j-openapi3-ui` | OpenAPI3 UI webjar，打包 `knife4j-front/knife4j-ui-react` 构建产物 |
| `knife4j-openapi2-spring-boot-starter` | Spring Boot 2.x + Springfox / Swagger2 |
| `knife4j-openapi3-spring-boot-starter` | Spring Boot 2.x + springdoc-openapi 1.x / OpenAPI3 |
| `knife4j-openapi3-jakarta-spring-boot-starter` | Spring Boot 3.x + springdoc-openapi 2.x / OpenAPI3 |
| `knife4j-openapi3-boot4-spring-boot-starter` | Spring Boot 4.x + springdoc-openapi 3.x / OpenAPI3 |
| `knife4j-openapi3-webflux-spring-boot-starter` | Spring Boot 2.x WebFlux 依赖编排 |
| `knife4j-openapi3-webflux-jakarta-spring-boot-starter` | Spring Boot 3.x WebFlux 依赖编排 |
| `knife4j-gateway-spring-boot-starter` | Spring Cloud Gateway 聚合 |
| `knife4j-aggregation-spring-boot-starter` | Spring Boot 2.x 独立聚合 |
| `knife4j-aggregation-jakarta-spring-boot-starter` | Spring Boot 3.x 独立聚合 |
| `knife4j-demo-openapi2` | OpenAPI2 demo |
| `knife4j-demo-openapi3` | OpenAPI3 demo |
| `knife4j-smoke-tests` | 兼容性 smoke 测试集合 |

## Spring Boot 4

Spring Boot 4.x 使用独立 starter，避免把现有 Spring Boot 3.x + springdoc-openapi 2.x 用户带入 springdoc-openapi 3.x 依赖线：

```xml
<dependency>
    <groupId>com.baizhukui</groupId>
    <artifactId>knife4j-openapi3-boot4-spring-boot-starter</artifactId>
    <version>5.0.3</version>
</dependency>
```

该 starter 面向 Spring Boot 4.x WebMVC + springdoc-openapi 3.x，应用侧仍应使用 Spring Boot 4 的依赖管理。

## 本地启动

以下命令从仓库根目录运行。

OpenAPI3 demo：

```bash
cd knife4j
mvn -pl knife4j-demo-openapi3 -am spring-boot:run
# 浏览器打开 http://localhost:8080/doc.html
```

OpenAPI2 demo：

```bash
cd knife4j
mvn -pl knife4j-demo-openapi2 -am spring-boot:run
# 浏览器打开 http://localhost:8081/doc.html
```

默认访问入口保持为：

```text
http://ip:port/doc.html
```

OpenAPI3 运行时发现入口为：

```text
/knife4j/config
```

该接口用于 Knife4j UI 发现实际的 springdoc 配置路径，由 UI 内部调用，并会从 OpenAPI 文档中隐藏，不展示在 `doc.html` 接口列表里。响应结构固定以 `schemaVersion` 标识契约版本，并在 `openapi` 下暴露 `apiDocsUrl` 与 `swaggerConfigUrl`。例如自定义 `springdoc.api-docs.path=/api/openapi` 时：

```json
{
  "schemaVersion": "1",
  "openapi": {
    "apiDocsUrl": "api/openapi",
    "swaggerConfigUrl": "api/openapi/swagger-config"
  }
}
```

## 本地测试

从仓库根目录运行：

```bash
./scripts/test-java.sh
```

如需手动复现脚本中的 Maven 步骤：

```bash
cd knife4j
mvn -B -ntp spotless:check
mvn -B -ntp -Dknife4j-skipTests=false verify
```

提交前仍以根目录 `./scripts/test-java.sh` 为准；它还会在 Maven 构建后检查 smoke 测试证据。

更多接入、迁移和模块说明见仓库根目录 `README.md` 与 `docs-site/`。
