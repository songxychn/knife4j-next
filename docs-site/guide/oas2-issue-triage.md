---
title: OAS2 UI Issue 初筛（knife4j-vue3）
---

# OAS2 UI Issue 初筛（knife4j-vue3）

本文汇总 upstream `xiaoymin/knife4j` 中属于 **OAS2 / Swagger 2 场景**的 UI issue，并按 knife4j-next 的[前端分工策略](/guide/migration#spring-boot-2-x-springfox-openapi2)给出处置结论。

> **前端分工策略摘要**：`knife4j-vue3` 只做回归修复、安全补丁、显示层 bug 修复，不做功能扩张。OAS2 场景的新功能请求一律按 `wontfix: scope-policy` 关闭，引导用户迁移到 OAS3 starter。

::: warning 这不是当前任务队列
这页是 upstream issue 的历史初筛记录，不代表 issue 已在本仓库复现、修复或承诺排期。真正开工前必须重新阅读 upstream 原文、在当前仓库复现，并在本仓库 issue / PR 中写清楚实际范围；不要只凭 upstream 标题或截图认定修复方向。
:::

---

## 可做最小兼容修复

以下 issue 属于显示层 bug 或配置兼容问题，可在 `knife4j-vue3` 内做最小修复，不涉及功能扩张。

| upstream issue | 摘要 | 处置状态 |
|---|---|---|
| [#523](https://github.com/xiaoymin/knife4j/issues/523) | 设置全局安全验证后调试请求不生效（v4.0.0） | 待当前仓库复现后决定 |
| [#608](https://github.com/xiaoymin/knife4j/issues/608) | 3.0.3 版本多文件上传不显示上传按钮（springfox 3.0.x） | 待当前仓库复现后决定 |
| [#638](https://github.com/xiaoymin/knife4j/issues/638) | 4.3.0 版本文件上传不显示上传选择文本域 | 待当前仓库复现后决定 |
| [#758](https://github.com/xiaoymin/knife4j/issues/758) | yml 不支持 `showTagStatus` 但前端有此参数 | 待当前仓库复现后决定 |
| [#565](https://github.com/xiaoymin/knife4j/issues/565) | `application/json` 内写 schema 无法显示（OAS2 写法） | 待当前仓库复现后决定 |

**修复原则**：每个 issue 独立 PR；如果确认为 OAS2 UI 显示层问题，修复范围限于 `knife4j-vue3/src/`，不引入新功能，不改动 `knife4j-core`（TypeScript）。如果复现结果指向 Java / 静态资源 / 聚合路径，应重新归到对应后端任务。

---

## wontfix: scope-policy（功能扩张类）

以下 issue 属于 UX 新功能或调试器增强，按分工策略不在 `knife4j-vue3` 实现。对应功能已在 `knife4j-ui-react`（OAS3 主线）覆盖或规划中。

| upstream issue | 摘要 | wontfix 原因 |
|---|---|---|
| [#742](https://github.com/xiaoymin/knife4j/issues/742) | GET/DELETE 参数默认勾选 | UX 新功能，OAS3 主线在 `knife4j-ui-react` 实现；建议 OAS2 用户迁移 |
| [#661](https://github.com/xiaoymin/knife4j/issues/661) | UI 支持显示必填选项 | 同上，已在 `knife4j-ui-react` 覆盖 |
| [#684](https://github.com/xiaoymin/knife4j/issues/684) | 字段长度展示 | 同上 |
| [#693](https://github.com/xiaoymin/knife4j/issues/693) | Ctrl 多选上传 `MultipartFile[]` | 调试器新功能，不回写 `knife4j-vue3` |
| [#788](https://github.com/xiaoymin/knife4j/issues/788) | 导出 Word 格式错乱 | 导出体验改进，已在 `knife4j-ui-react` 重做；OAS2 保留现状 |
| [#550](https://github.com/xiaoymin/knife4j/issues/550) | 语言切换回调（i18n 扩展） | 功能扩张，`knife4j-ui-react` 主线考虑 |

**处置方式**：在本仓库 issue / PR 中说明分工策略，并附 OAS3 迁移指南链接。是否回帖 upstream 由维护者按场景决定，不把回帖当作完成条件。

---

## 待判定（静态资源 / 启动期问题）

以下 issue 同时影响 OAS2 + OAS3 的静态资源行为，属于 Java 侧问题，不在 `knife4j-vue3` 修复。

| upstream issue | 摘要 | 处置方向 |
|---|---|---|
| [#503](https://github.com/xiaoymin/knife4j/issues/503) | Tomcat `Http11Nio2Protocol` 时文档页面不显示 | 待当前仓库复现后判定是否为 Java 启动 / 静态资源问题 |
| [#687](https://github.com/xiaoymin/knife4j/issues/687) | 测试环境访问 `doc.html` 返回 500 | 待当前仓库复现后判定是否为 Java 启动 / 静态资源问题 |
| [#666](https://github.com/xiaoymin/knife4j/issues/666) | 静态资源 `Content-type` 响应不对 | 不再直接归入 #198；需按静态资源 MIME / MessageConverter 顺序方向独立复现与跟踪 |

---

## 回帖模板

对 wontfix 类 issue，如果维护者决定回帖 upstream，可使用以下模板（中文）：

```
感谢反馈！

这个功能请求属于 UI 增强类需求。根据 knife4j-next 的前端分工策略：

- `knife4j-vue3`（对应 `knife4j-openapi2-spring-boot-starter`）处于**兼容维护模式**，只接收回归修复与显示层 bug，不再添加新功能。
- 您描述的功能已在 `knife4j-ui-react`（对应 OAS3 starter）中实现或规划中。

**建议**：迁移到 `knife4j-openapi3-*-spring-boot-starter` 即可使用新 UI 特性。迁移成本很低，只需替换 Maven 依赖坐标：

- 迁移指南：https://knife4jnext.com/guide/migration
- Springfox → OpenAPI3 完整迁移：https://knife4jnext.com/guide/springfox-migration

如果您有强烈的 OAS2 保留需求，欢迎提交 PR 到 https://github.com/songxychn/knife4j-next，范围限于 `knife4j-vue3/src/` 显示层修复。
```

---

## 相关

- [从 upstream 迁移](/guide/migration)
- [从 Springfox 迁移到 OpenAPI3](/guide/springfox-migration)
- [发布说明](/release-notes/)
