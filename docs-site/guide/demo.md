---
title: Demo 预览
---

# Demo 预览

knife4j-next 提供两个并列的 demo 工程，分别覆盖两条独立的 UI 产物线。可以在线直接体验，也可以拷回本地二次改造。

## 在线预览

| Demo | 后端 | UI 产物 | 在线地址 |
| --- | --- | --- | --- |
| `knife4j-demo-openapi3` | Spring Boot 3.4 + springdoc + `knife4j-openapi3-jakarta-spring-boot-starter` | React（`knife4j-openapi3-ui`） | [https://openapi3.demo.knife4jnext.com/doc.html](https://openapi3.demo.knife4jnext.com/doc.html) |
| `knife4j-demo-openapi2` | Spring Boot 2.7 + springfox 2.10.5 + `knife4j-openapi2-spring-boot-starter` | Vue 3（`knife4j-openapi2-ui`） | [https://openapi2.demo.knife4jnext.com/doc.html](https://openapi2.demo.knife4jnext.com/doc.html) |

两个站点都跟随 `master` 分支自动构建与刷新，建议直接打开比对，看看 OpenAPI 3 主线和 OpenAPI 2 兼容维护线在 UI 上的差异。

如果访问失败，优先在本地跑一遍，避免把预览环境问题当成功能问题。

## `knife4j-demo-openapi3`（OpenAPI 3 主线）

### 工程位置

- 模块路径：`knife4j/knife4j-demo-openapi3`
- 主类：`com.baizhukui.knife4j.demo.openapi3.DemoApplication`
- Controller：`com.baizhukui.knife4j.demo.openapi3.UserController` 等
- DTO：`com.baizhukui.knife4j.demo.openapi3.dto.*`

### 技术栈

| 组件 | 版本 | 说明 |
| --- | --- | --- |
| Spring Boot | `3.4.5` | demo `pom.xml` 显式声明 |
| knife4j starter | `knife4j-openapi3-jakarta-spring-boot-starter` | 本仓库 `5.0.0` |
| JDK | 17 | Dockerfile base image `eclipse-temurin:17-jre-alpine` |
| springdoc-openapi-jakarta | `2.8.9` | 由 starter 管理 |

### 展示了什么

`UserController` 等示例覆盖 OpenAPI 3 注解下最常见的用法，全部使用 `io.swagger.v3.oas.annotations.*`：

- `@Tag` 分组
- `@Operation` + `@Parameter` + `@RequestBody` 描述接口与参数
- `@Schema` 描述 DTO 字段
- 分页、CRUD、路径参数、请求体参数组合
- 文件上传（`multipart/form-data` + JSON part，`encoding.contentType=application/json`）
- 泛型、多层嵌套、`$ref` 等回归复现 case

建议作为接入 knife4j-next 的**基线模板**。

### 快速运行

::: code-group

```bash [IDE]
# 1. 打开仓库根目录，让 IDE 识别 Maven 多模块
# 2. 运行 com.baizhukui.knife4j.demo.openapi3.DemoApplication
# 3. 浏览器打开 http://localhost:8080/doc.html
```

```bash [Maven]
cd knife4j
./mvnw -pl knife4j-demo-openapi3 -am spring-boot:run
# 浏览器打开 http://localhost:8080/doc.html
```

```bash [打包后运行]
cd knife4j
./mvnw -pl knife4j-demo-openapi3 -am package -DskipTests
java -jar knife4j-demo-openapi3/target/knife4j-demo-openapi3-*.jar
```

```bash [Docker]
docker run --rm -p 8080:8080 \
  ghcr.io/songxychn/knife4j-next/knife4j-next-demo-openapi3:latest
```

:::

### 访问入口

| 入口 | 说明 |
| --- | --- |
| `http://localhost:8080/` | 重定向到 `/doc.html`（由 `RootRedirectController` 提供） |
| `http://localhost:8080/doc.html` | Knife4j UI（React 前端） |
| `http://localhost:8080/v3/api-docs` | 原始 OpenAPI JSON |
| `http://localhost:8080/swagger-ui.html` | springdoc 默认 Swagger UI（可对比） |

## `knife4j-demo-openapi2`（OpenAPI 2 兼容维护线）

### 工程位置

- 模块路径：`knife4j/knife4j-demo-openapi2`
- 主类：`com.baizhukui.knife4j.demo.openapi2.DemoApplication`
- Controller：`com.baizhukui.knife4j.demo.openapi2.UserController`、`UploadController`
- DTO：`com.baizhukui.knife4j.demo.openapi2.dto.*`

### 技术栈

| 组件 | 版本 | 说明 |
| --- | --- | --- |
| Spring Boot | `2.7.18` | 由根 pom `knife4j-spring-boot.version` 管理 |
| knife4j starter | `knife4j-openapi2-spring-boot-starter` | 本仓库 `5.0.0` |
| JDK | 8 | Dockerfile base image `eclipse-temurin:8-jre-alpine` |
| springfox | `2.10.5` | Swagger 2 注解解析 |

### 展示了什么

覆盖 OpenAPI 2 / Swagger 2 的核心使用场景（范围精简，不重复 OpenAPI 3 demo 中的 issue 复现内容）：

- `@Api` / `@ApiOperation` / `@ApiImplicitParam` 描述接口与参数
- `@ApiModel` / `@ApiModelProperty` 描述 DTO 字段
- 分页、CRUD、路径参数、请求体参数组合
- `multipart/form-data` 文件上传

> OpenAPI 2 是兼容维护线，**不接受新功能扩张**。如果你需要 OAuth2 弹窗授权、新的 Markdown 特性、导出能力等，建议迁移到 OpenAPI 3 主线。

### 快速运行

::: code-group

```bash [IDE]
# 1. 打开仓库根目录，让 IDE 识别 Maven 多模块
# 2. 运行 com.baizhukui.knife4j.demo.openapi2.DemoApplication
# 3. 浏览器打开 http://localhost:8081/doc.html
```

```bash [Maven]
cd knife4j
./mvnw -pl knife4j-demo-openapi2 -am spring-boot:run
# 浏览器打开 http://localhost:8081/doc.html
```

```bash [打包后运行]
cd knife4j
./mvnw -pl knife4j-demo-openapi2 -am package -DskipTests
java -jar knife4j-demo-openapi2/target/knife4j-demo-openapi2-*.jar
```

```bash [Docker]
docker run --rm -p 8081:8081 \
  ghcr.io/songxychn/knife4j-next/knife4j-next-demo-openapi2:latest
```

:::

### 访问入口

| 入口 | 说明 |
| --- | --- |
| `http://localhost:8081/` | 重定向到 `/doc.html`（由 `RootRedirectController` 提供） |
| `http://localhost:8081/doc.html` | Knife4j UI（Vue 3 前端） |
| `http://localhost:8081/v2/api-docs` | 原始 Swagger 2 JSON |
| `http://localhost:8081/swagger-resources` | knife4j / Vue 3 UI 依赖的分组列表端点 |

## 镜像发布

两个 demo 镜像都由 `.github/workflows/deploy-demo.yml` 在 `master` 推送时通过 matrix 构建并推送到 GitHub Container Registry：

- `ghcr.io/songxychn/knife4j-next/knife4j-next-demo-openapi3:latest`
- `ghcr.io/songxychn/knife4j-next/knife4j-next-demo-openapi2:latest`

官方在线预览站点结合 `watchtower` 做自动升级。

## 拿来改的最小清单

如果你想拷贝某个 demo 做自己的工程：

1. 选择和你后端栈匹配的目录：`knife4j/knife4j-demo-openapi3`（OpenAPI 3 + Boot 3）或 `knife4j/knife4j-demo-openapi2`（OpenAPI 2 + Boot 2）。
2. 改 `pom.xml` 的 `groupId`/`artifactId`/`name`。
3. 替换 package 命名空间为你的项目命名空间。
4. 按需调整 `application.yml`（OpenAPI 3 调 `springdoc.group-configs.packages-to-scan`，OpenAPI 2 调 `Docket` 中的 `basePackage`）。
5. 保留 `knife4j.enable: true` 以启用 knife4j 增强。

更详细的接入说明见 [快速开始](./getting-started)。

