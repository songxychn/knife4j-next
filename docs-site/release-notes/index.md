---
title: 发布说明
---

# 发布说明

本页记录 knife4j-next（`com.baizhukui` 坐标）所有版本的变更，以及上游 knife4j 的历史版本供参考。

> 判断"值不值得升"？对照 [兼容矩阵](/reference/compatibility) 和 [迁移指引](/guide/migration)。

---

## knife4j-next 版本（com.baizhukui）

### 4.6.0.3

**前端**
- 集成 knife4j-ui-react（React 下一代前端）到 `knife4j-openapi3-ui` webjar
- 新增设置面板（Header 右上角），整合 Authorize / GlobalParam / OfflineDoc 三个 Tab
- 实现离线文档导出（HTML / Word）
- 实现 Home 页、ApiDoc 页、ApiDebug 页、SwaggerModels 页
- 实现 Authorize、GlobalParam 功能页
- 实现侧边栏分组切换与搜索过滤
- 接入真实 API 数据层（OpenAPI 解析）

**其他**
- demo 模块：根路径 `/` 重定向至 `/doc.html`
- demo 模块：接口示例改用 DTO + `@Schema` 注解

---

### 4.6.0.2

**Bug 修复**
- 修复 `/v2/api-docs` 路径加分号可绕过 Basic 认证的安全漏洞（#886）
- 修复 gateway `context-path` 配置导致聚合 host 缺少斜杠的问题（#954）

**兼容性**
- 兼容 Spring Boot 3.4.x / 3.5.x（升级 springdoc-openapi-jakarta 至 2.8.9）
- 新增 Boot 3.5.0 smoke 测试模块

**新增**
- 新增 `knife4j-demo` 在线预览模块，支持 Docker 部署
- 新增 KUtils 单元测试覆盖
- 文档站（docs-site）导航修复
- CI 全面迁移至 Node.js 24

---

### 4.6.0.1

- Maven `groupId` 已切到 `com.baizhukui`
- 仓库已经补齐 GitHub Actions 构建与发布流程
- 当前优先处理兼容性、回归问题和发版恢复

---

## 上游 knife4j 版本（com.github.xiaoymin）

> 以下版本来自上游 `xiaoymin/knife4j`，knife4j-next 基于最后的 4.5.0 版本 fork。

### 4.5.0（2024-01-08）— 上游最终版本

- 新增日语 i18n 支持（Gitee#PR98）
- 修复 `EnvironmentPostProcessor` 与用户 `defaultProperties` 冲突（Gitee#PR100）
- 修复 `addOrderExtension` NPE（Gitee#PR99）
- **修复 Spring Boot 3 下 `@ApiOperationSupport` 的 `order` 不生效**（核心修复）
- 修复 `springdoc.group-configs.packages-to-scan` 未设置时的 NPE（Gitee#I8O7E8）
- 修复 `@Schema.description` 在实体参数上不渲染（Gitee#I8EVO3, GitHub#690）
- 修复 OpenAPI 3 请求参数 `format` 属性展示异常（Gitee#I8KRWV）
- 修复自定义文档中服务名含连字符时刷新报错（Gitee#I8EKAQ）
- 移除文档 `favicon.ico` 引用（GitHub#716）
- 企业插件扩展点（Orangeforms 低代码平台）

---

### 4.4.0（2023-12-10）— OpenAPI 自动注册

- 修复 Eureka 大写服务名导致 gateway 聚合失败（Gitee#93）
- 修复调试 body 请求文件下载乱码
- 修复 gateway 聚合中 springdoc 子服务默认 `/default` 路径 404（Gitee#I7RAP7）
- 修复 Boot 3 下 gateway Basic 认证密码不兼容（GitHub#PR652）
- 修复 Boot 3 `javax.filter` 兼容性（GitHub#667）
- 无默认分组时 UI 显示分组名称
- 修复 `SecurityDocketUtils` 绑定 `SecurityContext` 到错误引用（Gitee#I88IYH）
- 离线 HTML 文档改用国内 CDN（Gitee#I8C85P）
- 升级 springdoc-openapi 至 **2.3.0**
- 修复 `EnvironmentPostProcessor` 与用户 `defaultProperties` 冲突（GitHub#686）

---

### 4.3.0（2023-08-06）— Gateway 极简配置

- `excluded-services` 支持正则匹配（如 `order.*`）
- 修复两个子服务根路由转发时只聚合一个的问题
- 修复 `DiscoveryClient` 作为默认转发路由时聚合失败
- 修复 Swagger 2 聚合失败
- 手动模式支持 Swagger 2 与 OpenAPI 3 **混合聚合**
- 修复全部子服务为 Swagger 2 时的 `contextPath` 错误
- 重构 gateway 内部，`discover` 模式提供 4 种路由来源策略
- 修复 `@ApiSupport` 不生效（Gitee#PR89）
- 修复 Swagger model 枚举值不展开（Gitee#PR90）
- 修复组件冲突（GitHub#620）
- 新增 `title` 属性支持（Gitee#I7KUYP）

---

### 4.2.0（2023-07-31）— Gateway 增强

- 升级 Spring Boot 3 至 **3.0.7**，springdoc 至 **1.7.0** / **2.1.0**
- `discover` 模式自动读取 gateway 路由 `prefix`
- 支持多 group 类型（非仅 `default`）
- 新增 `GatewayServiceExcludeService` SPI 用于排除服务（Gitee#I6YLMB）
- 修复 Nginx / 二级代理路径问题（Gitee#I73AOG, #I6KYUJ; GitHub#609, #603, #586）
- 新增 `tags-sorter` / `operations-sorter` 排序配置
- gateway 组件支持 Basic 认证（GitHub#555）
- 生成的 TypeScript 代码包含注释（Gitee#I6T78E, GitHub#568）
- OpenAPI 2 `allOf` 支持（GitHub#PR589）
- `jakarta` Basic 属性提示修复（GitHub#578）
- **OpenAPI 3 开始支持 `@ApiSupport` 增强注解**（Gitee#I79WIJ）
- `lombok`、`slf4j` 改为 `provided` scope（GitHub#591）

---

### 4.1.0（2023-03-23）— 16 项 Bug 修复 + Gateway 发现模式

- 修复 gateway 聚合 OpenAPI 3 丢失 `context-path`
- 升级 springdoc-openapi 至 **1.6.15** / **2.0.4**
- 修复 `knife4j-openapi3-jakarta-spring-boot-starter` IDEA 属性提示
- 修复自定义文档分组加载 Bug（GitHub#PR525）
- 修复 `knife4j-dependencies` 模块缺少版本号
- 修复缺少 `springdoc-openapi-ui` 依赖时的 NPE
- 修复 OAS3 参数缺少 `field-description`
- 修复 OAS3 扩展属性（order、author 等）不生效（Gitee#I6FB9I）
- 修复部分字段翻译问题（GitHub#540）
- 修复 `production` 模式启用增强属性时的 NPE（GitHub#527）
- 修复 OpenAPI 3 tag-name 兼容性（Gitee#I6JATP）
- 修复 URL 参数实体类不展示参数描述（Gitee#I6H8CD）
- 修复 OAS3 上传组件识别（Gitee#I6HAW0, GitHub#538）
- **新增 Spring WebFlux starter 打包**（GitHub#521）
- Basic 认证新增 `include` 属性用于自定义包含路径（GitHub#530）
- 全局搜索支持 tag-name 模糊搜索（Gitee#I6NWV6）
- **Gateway 新增 `discover` 服务发现聚合模式**

---

### 4.0.0（2022-12-20）— 架构重写（大版本）

- 统一所有模块版本号，**`artifactId` 名称变更**（Breaking Change）
- **新增 Spring Boot 3 支持**，通过 `jakarta` starter
- 采用 **springdoc-openapi** 作为 OpenAPI 3 底层框架（替代 springfox 3.0）
- 保留 springfox 2.10.5 用于 OpenAPI 2 / Boot 2 路径
- 重写 Knife4j-Desktop 聚合架构，发布官方 Docker 镜像
- 全新模块布局：
  - `knife4j-core`、`knife4j-dependencies`
  - `knife4j-openapi2-ui`、`knife4j-openapi3-ui`
  - `knife4j-openapi2-spring-boot-starter`（Boot < 3 + OAS2）
  - `knife4j-openapi3-spring-boot-starter`（Boot < 3 + OAS3）
  - `knife4j-openapi3-jakarta-spring-boot-starter`（Boot ≥ 3 + OAS3）
  - `knife4j-gateway-spring-boot-starter`、`knife4j-aggregation-spring-boot-starter`
- **配置属性命名改为 kebab-case**（Breaking Change）
  - 如 `enableSwaggerModels` → `enable-swagger-models`
  - 如 `footerCustomContent` → `footer-custom-content`

---

## 版本号说明

knife4j-next 的版本号遵循 `<upstream-version>.<patch>` 格式：

```
4.5.0 → 上游 knife4j 4.5.0（最后上游版本）
4.6.0.1 → fork 后第一个补丁版本
4.6.0.2 → fork 后第二个补丁版本（安全修复 + Boot 3.4/3.5 兼容）
4.6.0.3 → fork 后第三个补丁版本（React 前端集成）
```

从 4.6.0.1 开始，Maven 坐标变更为 `com.baizhukui`：
```xml
<dependency>
    <groupId>com.baizhukui</groupId>
    <artifactId>knife4j-openapi3-jakarta-spring-boot-starter</artifactId>
    <version>4.6.0.3</version>
</dependency>
```

详见 [版本参考](/reference/version-ref) 和 [迁移指引](/guide/migration)。
