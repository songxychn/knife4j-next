# 快速开始

通过 starter 接入 Knife4j Next 后，你可以在 Spring Boot 应用中直接获得增强版 OpenAPI 文档页面，并通过 `doc.html` 完成接口浏览和在线调试。

## 1. 选择依赖

### Spring Boot 2.x

```xml
<dependency>
    <groupId>com.baizhukui</groupId>
    <artifactId>knife4j-openapi2-spring-boot-starter</artifactId>
    <version>4.6.0.1</version>
</dependency>
```

### Spring Boot 3.x

```xml
<dependency>
    <groupId>com.baizhukui</groupId>
    <artifactId>knife4j-openapi3-jakarta-spring-boot-starter</artifactId>
    <version>4.6.0.1</version>
</dependency>
```

## 2. 保持默认入口

应用启动后，继续通过下面的地址访问文档：

```text
http://ip:port/doc.html
```

`doc.html` 是 Knife4j 默认的文档入口，适合在开发、测试和联调环境中快速访问接口文档。

## 3. 验证接入效果

1. 启动 Spring Boot 应用。
2. 访问 `http://ip:port/doc.html`。
3. 检查接口分组、请求参数和响应模型是否正常展示。
4. 如果项目使用鉴权、网关或上下文路径，再继续验证对应场景。

## 4. 本地开发

如果你要本地运行这个 VitePress 文档站：

```bash
cd docs-site
npm install
npm run dev
```

默认会启动在：

```text
http://127.0.0.1:5173/
```

## 5. 下一步

- 查看 [兼容矩阵](/reference/compatibility)，确认当前项目使用的 Spring Boot 版本。
- 查看 [迁移指引](/guide/migration)，了解从已有 Knife4j 项目切换时需要注意的依赖变化。
- 查看 [模块说明](/reference/modules)，了解 starter、UI webjar 和前端模块的关系。
