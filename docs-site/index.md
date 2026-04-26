---
layout: home

hero:
  name: Knife4j Next
  text: 更现代的 Knife4j
  tagline: 延续熟悉的 doc.html 接入方式，持续修复 Spring Boot 2.7 / 3.x 的兼容性。这是 Knife4j 的社区维护 fork。
  image:
    src: /knife4j-next-mark.svg
    alt: Knife4j Next
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: 从 upstream 迁移
      link: /guide/migration
    - theme: alt
      text: GitHub
      link: https://github.com/songxychn/knife4j-next

features:
  - title: 保持 doc.html 使用习惯
    details: Maven groupId 切到 com.baizhukui 即可替换原依赖，/doc.html、/v2/api-docs、/v3/api-docs 入口保持不变。
    link: /guide/migration
    linkText: 迁移指引
  - title: Spring Boot 2.7、3.4、3.5 都跑过
    details: 4 个 smoke 模块（Boot 2.7.18、Boot 3.4.0、Boot 3.5.0）随每次构建回归，springdoc-openapi-jakarta 已对齐 2.8.9。
    link: /reference/compatibility
    linkText: 兼容矩阵
  - title: React + Vite 新前端
    details: knife4j-openapi3-ui webjar 已集成 React 前端，支持国际化、类型感知参数输入、OAuth2 授权码流程、响应复制/下载等。
    link: /release-notes/
    linkText: 发布说明
  - title: Gateway 与多服务聚合
    details: knife4j-gateway-spring-boot-starter 支持 DISCOVER / MANUAL 两种策略；aggregation starter 另外提供 disk / cloud / nacos / eureka / polaris 五种聚合模式。
    link: /guide/gateway
    linkText: 网关接入
---

## 这是 Knife4j 的 fork，不是重写

`knife4j-next` 是 [`xiaoymin/knife4j`](https://github.com/xiaoymin/knife4j) 的社区维护分支。

- 保留 `com.github.xiaoymin.knife4j.*` Java 包名，不做重命名。
- 保留 `doc.html` / `v2/api-docs` / `v3/api-docs` 访问入口。
- 保留 `@ApiOperationSupport`、`@ApiSupport`、`knife4j.*` 等全部既有注解与配置键。
- 只改 `groupId`：`com.github.xiaoymin` → `com.baizhukui`，其余业务代码不用动。

## 60 秒上手

Spring Boot 3.x（Jakarta）：

```xml
<dependency>
    <groupId>com.baizhukui</groupId>
    <artifactId>knife4j-openapi3-jakarta-spring-boot-starter</artifactId>
    <version>1.0.0</version>
</dependency>
```

最小配置：

```yaml
knife4j:
  enable: true
  setting:
    language: zh_cn

springdoc:
  swagger-ui:
    path: /swagger-ui.html
  api-docs:
    path: /v3/api-docs
```

启动应用后访问 `http://localhost:8080/doc.html`。完整流程见 [快速开始](/guide/getting-started)。

## 1.0.0 版本亮点 <Badge type="tip" text="即将发布" />

- 🌐 国际化：zh-CN / en-US 双语切换
- 🔐 Authorize 支持 OAuth2 授权码流程 + securitySchemes 动态渲染
- 📋 ApiDebug 类型感知参数输入、cURL 预览、响应复制/下载
- 🗂️ Tab 右键菜单 + 刷新后状态持久化
- 🔍 侧边栏接口搜索高亮 + Method 过滤条
- 📄 ApiDoc 工具栏：复制 endpoint / Markdown / URL
- 🧱 knife4j-core 提取 debug 解析层（82 项单元测试）
- 🐳 `knife4j-demo` 模块提供 Docker Compose 在线预览

完整更新列表见 [发布说明](/release-notes/)。

::: warning 关于新前端覆盖范围
新 React 前端当前**仅覆盖部分** upstream 增强特性。如果你依赖的是 `knife4j.setting.enable-debug=false`、`enable-footer-custom`、`home-custom-path`、`swagger-model-name`、`enable-after-script`、`enable-version`、Postman 导出，请在切换到新前端前先查阅 [新前端覆盖范围](/roadmap/#react-ui-coverage)。`knife4j-openapi2-ui` 仍是 Vue2 旧前端，所有 upstream 特性继续可用。
:::

## 文档导航

**上手**

- [产品介绍](/guide/introduction)：这个 fork 的定位、与 upstream 的对照表
- [快速开始](/guide/getting-started)：Spring Boot 2.x / 3.x 完整接入
- [迁移指引](/guide/migration)：从 `com.github.xiaoymin` 切到 `com.baizhukui`
- [Demo 预览](/guide/demo)：`knife4j-demo` 模块、本地跑 / Docker Compose
- [常见问题](/guide/faq)：doc.html 404、生产环境禁用、Nginx 反向代理、React 配置不生效

**组件**

- [Gateway 聚合](/guide/gateway)：Spring Cloud Gateway + knife4j-gateway-starter
- [Aggregation 聚合](/guide/aggregation)：disk / cloud / nacos / eureka / polaris
- [WebFlux 方案](/guide/webflux)：当前 fork 中的 webflux 实际情况与替代路径

**参考**

- [兼容矩阵](/reference/compatibility)：Java、Spring、Boot、springdoc 基线
- [版本参考表](/reference/version-ref)：Boot 版本如何选 knife4j 版本
- [模块说明](/reference/modules)：14 个 Maven 模块的职责与选择决策
- [配置参考](/reference/configuration)：全部 `knife4j.*` YAML 选项
- [注解速查](/reference/annotations)：Springfox 专有 vs 通用注解

**其他**

- [路线图](/roadmap/)：当前任务队列 + React UI 覆盖缺口清单
- [发布说明](/release-notes/)：版本更新记录
