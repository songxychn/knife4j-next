---
title: OAS2 UI Issue 盘点（knife4j-vue3）
---

# OAS2 UI Issue 盘点（knife4j-vue3）

本文汇总 upstream `xiaoymin/knife4j` 中属于 **OAS2 / Swagger 2 场景**的 UI issue，并按 knife4j-next 的[前端分工策略](/guide/migration#spring-boot-2x-springfox-openapi2)给出处置结论。

> **前端分工策略摘要**：`knife4j-vue3` 只做回归修复、安全补丁、显示层 bug 修复，不做功能扩张。OAS2 场景的新功能请求一律按 `wontfix: scope-policy` 关闭，引导用户迁移到 OAS3 starter。

---

## 可做最小兼容修复

以下 issue 属于显示层 bug 或配置兼容问题，可在 `knife4j-vue3` 内做最小修复，不涉及功能扩张。

| upstream issue | 摘要 | 处置状态 |
|---|---|---|
| [#523](https://github.com/xiaoymin/knife4j/issues/523) | 设置全局安全验证后调试请求不生效（v4.0.0） | 待独立 PR |
| [#608](https://github.com/xiaoymin/knife4j/issues/608) | 3.0.3 版本多文件上传不显示上传按钮（springfox 3.0.x） | 待独立 PR |
| [#638](https://github.com/xiaoymin/knife4j/issues/638) | 4.3.0 版本文件上传不显示上传选择文本域 | 待独立 PR |
| [#758](https://github.com/xiaoymin/knife4j/issues/758) | yml 不支持 `showTagStatus` 但前端有此参数 | 待独立 PR（或补文档） |
| [#565](https://github.com/xiaoymin/knife4j/issues/565) | `application/json` 内写 schema 无法显示（OAS2 写法） | 待独立 PR |

**修复原则**：每个 issue 独立 PR，修复范围限于 `knife4j-vue3/src/` 显示层，不引入新功能，不改动 `knife4j-core`（TypeScript）。

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

**处置方式**：在 upstream 对应 issue 回帖，说明 knife4j-next 的分工策略，并附 OAS3 迁移指南链接（见下方[回帖模板](#回帖模板)）。

---

## 待判定（静态资源 / 启动期问题）

以下 issue 同时影响 OAS2 + OAS3 的静态资源行为，属于 Java 侧问题，不在 `knife4j-vue3` 修复。

| upstream issue | 摘要 | 处置方向 |
|---|---|---|
| [#503](https://github.com/xiaoymin/knife4j/issues/503) | Tomcat `Http11Nio2Protocol` 时文档页面不显示 | 纳入 #198 启动期 bug 子分组，Java 侧修复 |
| [#687](https://github.com/xiaoymin/knife4j/issues/687) | 测试环境访问 `doc.html` 返回 500 | 同上 |
| [#666](https://github.com/xiaoymin/knife4j/issues/666) | 静态资源 `Content-type` 响应不对 | 同上 |

---

## 回帖模板

对 wontfix 类 issue，在 upstream 回帖时使用以下模板（中文）：

```
感谢反馈！

这个功能请求属于 UI 增强类需求。根据 knife4j-next 的前端分工策略：

- `knife4j-vue3`（对应 `knife4j-openapi2-spring-boot-starter`）处于**兼容维护模式**，只接收回归修复与显示层 bug，不再添加新功能。
- 您描述的功能已在 `knife4j-ui-react`（对应 OAS3 starter）中实现或规划中。

**建议**：迁移到 `knife4j-openapi3-*-spring-boot-starter` 即可使用新 UI 特性。迁移成本很低，只需替换 Maven 依赖坐标：

- 迁移指南：https://knife4j-next.baizhukui.com/guide/migration
- Springfox → OpenAPI3 完整迁移：https://knife4j-next.baizhukui.com/guide/springfox-migration

如果您有强烈的 OAS2 保留需求，欢迎提交 PR 到 https://github.com/baizhukui/knife4j-next，范围限于 `knife4j-vue3/src/` 显示层修复。
```

---

## 相关

- [从 upstream 迁移](/guide/migration)
- [从 Springfox 迁移到 OpenAPI3](/guide/springfox-migration)
- [发布说明](/release-notes/)
