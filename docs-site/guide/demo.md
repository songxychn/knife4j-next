---
title: Demo 预览
---

# Demo 预览（knife4j-demo）

> 🚀 **在线体验**：[https://demo.knife4jnext.com/doc.html](https://demo.knife4jnext.com/doc.html) —— 点击即可直接打开最新版 `knife4j-next` 的效果。

`knife4j-demo` 是仓库内置的最小可运行工程，用来：

1. 作为**官方站点在线预览**的后端。
2. 让你在本地一条命令看到 `knife4j-next` 跑起来长什么样。
3. 提供一个现成的 `@Schema`、分页、CRUD 的参考工程。

## 工程位置

- 模块路径：`knife4j/knife4j-demo`
- 主类：`com.baizhukui.knife4j.demo.DemoApplication`
- Controller：`com.baizhukui.knife4j.demo.UserController`
- DTO：`com.baizhukui.knife4j.demo.dto.*`

## 技术栈

| 组件 | 版本 | 说明 |
| --- | --- | --- |
| Spring Boot | `3.4.5` | demo `pom.xml` 显式声明 |
| knife4j starter | `knife4j-openapi3-jakarta-spring-boot-starter`（本仓库当前版本） | `1.0.0` |
| JDK | 17 | Dockerfile base image `eclipse-temurin:17-jre-alpine` |
| springdoc-openapi-jakarta | `2.8.9` | 由 starter 管理 |

## 快速运行（三种方式）

### 方式 A：IDE 里跑

1. 打开仓库根目录，让 IDE 识别 Maven 多模块。
2. 运行 `com.baizhukui.knife4j.demo.DemoApplication`。
3. 浏览器打开 `http://localhost:8080/doc.html`。

### 方式 B：命令行 Maven

```bash
cd knife4j
./mvnw -pl knife4j-demo -am spring-boot:run
```

或构建可执行 jar 后直接运行：

```bash
./mvnw -pl knife4j-demo -am package -DskipTests
java -jar knife4j-demo/target/knife4j-demo-*.jar
```

### 方式 C：Docker Compose

仓库自带 `knife4j/knife4j-demo/docker-compose.yml`，使用 GitHub Container Registry 上的镜像：

```yaml
services:
  knife4j-demo:
    image: ghcr.io/songxychn/knife4j-next/knife4j-demo:latest
    container_name: knife4j-demo
    restart: unless-stopped
    labels:
      - "com.centurylinklabs.watchtower.enable=true"
```

启动：

```bash
cd knife4j/knife4j-demo
docker compose up -d
# 默认映射容器内 8080，可按需在 compose 中加 ports
```

该镜像由 `.github/workflows/deploy.yml` 随 `master` 每次推送自动构建并推到 `ghcr.io`，结合 `watchtower` 可以做到官方站点的自动升级。

## 访问入口

启动后（容器默认不暴露端口，本地开发建议用方式 A/B）：

| 入口 | 说明 |
| --- | --- |
| `http://localhost:8080/` | 重定向到 `/doc.html`（由 `RootRedirectController` 提供） |
| `http://localhost:8080/doc.html` | Knife4j UI（新 React 前端） |
| `http://localhost:8080/v3/api-docs` | 原始 OpenAPI JSON |
| `http://localhost:8080/swagger-ui.html` | springdoc 默认 Swagger UI（可对比） |

## Demo 里展示了什么

`UserController` 演示了 OpenAPI3 注解下最常见的用法，全部用 `io.swagger.v3.oas.annotations.*`：

- `@Tag` 分组
- `@Operation` + `@Parameter` + `@RequestBody` 描述接口与参数
- `@Schema` 描述 DTO 字段
- 分页、CRUD、路径参数、请求体参数组合

建议作为你自己工程接入 knife4j 的**基线模板**。

## 在线预览

官方站点提供的在线预览地址：

- 👉 [https://demo.knife4jnext.com/doc.html](https://demo.knife4jnext.com/doc.html) —— 点击直接打开，即可体验 knife4j-next 真实效果
- 版本跟随 `master`，每次 `master` 合并后由 `watchtower` 自动刷新

如果访问失败，优先在本地跑一遍，以避免把预览环境问题当成功能问题。

## 拿来改的最小清单

如果你想拷贝这个 demo 做自己的工程：

1. 把 `knife4j/knife4j-demo` 复制到独立仓库。
2. 改 `pom.xml` 的 `groupId`/`artifactId`/`name`。
3. 替换 package `com.baizhukui.knife4j.demo` 为你的命名空间。
4. 按需调整 `application.yml` 的 `springdoc.group-configs.packages-to-scan`。
5. 保留 `knife4j.enable: true` 以启用 knife4j 增强。

更详细的接入说明见 [快速开始](./getting-started)。

