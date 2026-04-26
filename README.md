# knife4j-next

`knife4j-next` 是一个面向社区持续维护的 `knife4j` fork，目标是以更稳定的发布节奏继续维护 `doc.html` 这套 API
文档增强体验，并逐步推进下一代前端与文档体系。

这个仓库当前优先解决的问题是：

- 跟进 Spring Boot 2.7 / 3.x / 3.5 与 Spring Framework 5.3 / 6.x 的兼容性
- 修复社区长期积压的回归与聚合场景问题
- 建立清晰、可重复的发布流程
- 为 React 方向的下一代前端做增量演进，而不是一次性推倒重来

## 项目状态

- 仓库来源：fork 自 `xiaoymin/knife4j`
- 当前定位：社区维护分支，不是 upstream 官方仓库
- Java 主坐标：`com.baizhukui`
- 当前版本：`1.0.1`
- 对外访问入口：`http://ip:port/doc.html`

> `doc.html` 仍然是默认访问入口，这一点保持与原项目兼容。

## 仓库模块

| 模块                | 说明                                                                        |
|-------------------|---------------------------------------------------------------------------|
| `knife4j`         | Java 主工程，包含 starter、UI webjar、聚合组件、Gateway starter、WebFlux starter 与依赖管理 |
| `docs-site`           | 当前文档站（VitePress）——项目对外文档的主入口                          |
| `knife4j-front`       | 下一代前端工作区（npm workspaces），活跃子模块为 `knife4j-core`（TypeScript 解析库）和 `knife4j-ui-react`（React UI） |
| `knife4j-smoke-tests` | smoke 测试，覆盖 Boot 2.x / Boot 3.x / Boot 3.x Jakarta / Boot 3.5 Jakarta 等组合 |
| `knife4j-vue`         | 历史前端实现，基于 Vue 2，以维护为主，不再作为主要演进方向                   |
| `knife4j-vue3`    | 社区贡献的实验性 Vue 3 前端实现，目前未作为主线发布                                             |
| `knife4j-insight` | 独立渲染/聚合方向的扩展方案                                                            |

## 当前维护策略

- Java 后端（`knife4j/`）：优先做兼容性修复、回归修复和发布维护，当前版本线 `1.0.x`
- `knife4j-vue`：以维护为主，不再作为主要演进方向
- `knife4j-front`：承接下一代前端探索，活跃模块为 `knife4j-core`（解析库）和 `knife4j-ui-react`（React UI）；`knife4j-ui`（基于 ant-design-pro 的旧实验）及 `knife4j-cli`、浏览器扩展等目前仅有占位，暂未启动开发
- 文档站：`docs-site/`（VitePress）是当前维护目标

## 快速开始

### Spring Boot 2.x

```xml

<dependency>
    <groupId>com.baizhukui</groupId>
    <artifactId>knife4j-openapi2-spring-boot-starter</artifactId>
    <version>1.0.1</version>
</dependency>
```

### Spring Boot 3.x (Jakarta)

```xml

<dependency>
    <groupId>com.baizhukui</groupId>
    <artifactId>knife4j-openapi3-jakarta-spring-boot-starter</artifactId>
    <version>1.0.1</version>
</dependency>
```

### Spring Boot 3.x (Javax)

```xml

<dependency>
    <groupId>com.baizhukui</groupId>
    <artifactId>knife4j-openapi3-spring-boot-starter</artifactId>
    <version>1.0.1</version>
</dependency>
```

### Spring Cloud Gateway

```xml

<dependency>
    <groupId>com.baizhukui</groupId>
    <artifactId>knife4j-gateway-spring-boot-starter</artifactId>
    <version>1.0.1</version>
</dependency>
```

启动应用后，默认通过以下地址访问：

```text
http://ip:port/doc.html
```

## 本地开发

### Java 主工程

```bash
cd knife4j
mvn -B -ntp verify
```

### 文档站

```bash
cd docs-site
npm install
npm run dev
```

### React 前端实验工程

```bash
cd knife4j-front
npm ci
npm run dev -w knife4j-ui-react
```

## 文档与链接

- 仓库地址：[songxychn/knife4j-next](https://github.com/songxychn/knife4j-next)
- Issue 反馈：[GitHub Issues](https://github.com/songxychn/knife4j-next/issues)
- Release 记录：[GitHub Releases](https://github.com/songxychn/knife4j-next/releases)
- Java 发布说明：[knife4j/RELEASE.md](./knife4j/RELEASE.md)
- 迁移指南：[knife4j/MIGRATION.md](./knife4j/MIGRATION.md)
- 文档站源码：[docs-site](./docs-site)

文档站基于 VitePress 构建，源码位于 `docs-site/`。涉及历史功能细节时，仍可参考 upstream 文档站 `https://doc.xiaominfo.com/`；该站点不由本仓库维护。

## 与 upstream 的关系

本仓库尊重并感谢原项目 `xiaoymin/knife4j` 的长期贡献。`knife4j-next` 的目标不是抹去
upstream，而是在其长时间未稳定发布的阶段，为现有用户提供一个更可预期的社区维护分支，并逐步补齐：

- 兼容性修复
- 迁移说明
- 文档与版本说明
- 更清晰的前端演进路线

## 注意事项

- 本仓库当前仍可能保留部分历史文档、图片、站点配置和旧链接，后续会逐步替换为 fork 自己的叙事与入口
- 如果你正在从 upstream 迁移，短期内最重要的变化是 Maven `groupId` 已切换为 `com.baizhukui`；详见 [迁移指南](./knife4j/MIGRATION.md)
- `knife4j-front` 下的 `knife4j-cli`、`knife4j-extension` 及各浏览器扩展子目录目前仅有占位 README，尚未开始实际开发
