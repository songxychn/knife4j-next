---
layout: home

hero:
  name: Knife4j Next
  text: 更现代的 Knife4j
  tagline: 为 Spring 生态提供开箱即用的 API 文档增强体验，覆盖文档浏览、接口调试、微服务聚合、鉴权配置、离线导出与团队协作。
  image:
    src: /knife4j-next-mark.svg
    alt: Knife4j Next
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: 了解功能
      link: /#%E6%A0%B8%E5%BF%83%E5%8A%9F%E8%83%BD

features:
  - title: 文档更清晰
    details: 在 Swagger / OpenAPI 的基础上增强接口分组、参数展示、模型结构和搜索体验，让后端接口对团队更可读。
  - title: 调试更顺手
    details: 直接在 doc.html 中完成接口请求、参数缓存、全局参数、OAuth2 / Basic Auth 等常见调试流程。
  - title: 聚合更简单
    details: 面向 Spring Cloud Gateway 与服务聚合场景，将多个服务的 OpenAPI 文档统一到一个入口展示。
  - title: 交付更完整
    details: 支持离线文档、Markdown / HTML 导出、自定义首页、访问控制和生产环境禁用等团队交付能力。
---

## 核心功能

<div class="status-grid">
  <div class="status-card">
    <span class="label">Browse</span>
    <strong>API 文档浏览</strong>
    <p>接口分组、模型结构、参数说明和全文搜索集中展示。</p>
  </div>
  <div class="status-card">
    <span class="label">Debug</span>
    <strong>在线接口调试</strong>
    <p>直接在页面内发起请求，支持常用鉴权和全局参数。</p>
  </div>
  <div class="status-card">
    <span class="label">Gateway</span>
    <strong>微服务文档聚合</strong>
    <p>为网关和多服务项目提供统一的 API 文档入口。</p>
  </div>
  <div class="status-card">
    <span class="label">Export</span>
    <strong>离线文档导出</strong>
    <p>将接口说明导出为团队交付更方便的离线文档。</p>
  </div>
</div>

## 适合哪些场景

<div class="signal-board">
  <p>如果你的团队已经在使用 Swagger、OpenAPI、Springfox 或 springdoc-openapi，但默认 UI 不够好用，Knife4j Next 可以作为更完整的文档增强层。</p>
  <p>它保留熟悉的 <code>/doc.html</code> 访问入口，同时提供更适合团队协作、联调和微服务聚合的功能。</p>
</div>

## 主要能力

- **接口分组与搜索**：让大型项目中的接口更容易查找、定位和理解。
- **请求参数增强**：支持全局参数、动态参数、参数缓存和请求过滤。
- **鉴权调试**：覆盖 Basic Auth、OAuth2 等常见接口调试场景。
- **模型展示增强**：更友好地展示请求体、响应体和嵌套模型结构。
- **网关聚合**：适合 Spring Cloud Gateway、多服务、多分组的文档统一展示。
- **离线交付**：支持将接口文档导出为离线格式，方便评审、归档和交付。
- **访问控制**：支持生产环境禁用、基础访问控制和文档入口保护。

## 接入方式

Spring Boot 2.x 和 Spring Boot 3.x 项目都可以通过 starter 快速接入。先从 [快速开始](/guide/getting-started) 选择适合你的依赖版本，然后启动应用访问：

```text
http://ip:port/doc.html
```
