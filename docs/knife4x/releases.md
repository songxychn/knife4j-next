---
title: Go 版本记录
---

# Go 版本记录

以下保留各已发布版本的历史范围，不代表所有能力在旧版本均可用。当前接入方式见[快速开始](./index.md)，API 见[配置参考](./configuration.md)。

## v0.10.0

相较于 `v0.9.2`，新增 Go 宿主的文档访问保护、多分组与 UI 配置（PR [#1053](https://github.com/songxychn/knife4j-next/pull/1053)）：

- `BasicAuth` 保护 UI 与配置中的本地 spec 路径；远端 spec 仍由目标服务负责鉴权和 CORS，业务 API 鉴权保持独立。
- `Disabled` 直接交还宿主 Handler，不验证文档配置或读取 Markdown；宿主必须自行停止注册 spec 路由，才能完整关闭文档。
- `Specs` 提供有序静态分组；`UISettings` 提供低于 spec 扩展和浏览器选择的默认值；`Documents` 提供附加 Markdown 文档。旧单 `SpecURL` / `BasePath` 接法保持兼容。
- 共享 UI 保留加载失败后的分组切换入口，并对齐鉴权路径。完整字段、优先级与保护范围见[配置参考](./configuration.md)及[部署说明](./deployment.md)。

公共库仍只依赖标准库，Go 1.22、Gin 示例 Go 1.26+、module 与 `NewHandler` 签名保持不变。浏览器下限、OpenAPI 3.0/3.1/3.2 JSON 消费、资源授权、预算与取消边界沿用 `v0.9.2`，仍不接受 YAML。部署继续保留同源 Schema Worker、动态分块及既有 CSP 和 JavaScript MIME 配置。源码构建与 UI 同步改用稳定 Bun `1.4.x`（最低 `1.4.4`），直接消费 Go module 无需 JavaScript 运行时。

## v0.9.2

同步共享 React UI 的窄屏抽屉导航、重页面与离线导出按需加载、键盘调宽、控件名称与标签语义修复；改善已定位的文字对比度，并修复数组自动示例和响应类型标签。Go API、路由、浏览器、OpenAPI 与部署边界沿用 `v0.9.1`，不声明全站 WCAG 合规。

## v0.9.1

相较于 `v0.9.0`，修复离线 Schema 跨文档声明 `$id` 引用、资源 owner / generation 隔离与无效依赖恢复；对浏览器无法编译的 Java 正则提供字段定位和诊断，保留手工输入（PR #998/#1015）。

修复 Markdown 标签接口与文档工具的路由冲突；优化接口说明、参数表、OpenAPI 和代码视图布局，补齐配置保存结果反馈并简化存储协调。更新 marked 18.1.2、URI 1.4.0、i18next 与 docx 9.15.0，修复 Markdown 边界、URI 身份隔离、multipart 标签插值和 Word XML 导出（PR #996/#997/#999/#1008/#1010/#1011/#1012/#1014）。

公共库仍只依赖标准库，Go 1.22、Gin 示例 Go 1.26+、module、`Config`、`NewHandler` 与路由语义不变。沿用 `v0.9.0` 的浏览器下限、Node 26 源码构建要求、OpenAPI 3.0/3.1/3.2 JSON 消费、离线授权、预算与取消边界。部署仍须保留同源 Schema Worker 及动态分块，满足既有 CSP 与 JavaScript MIME 要求。

## v0.9.0

相较于 `v0.8.9`，单接口 Markdown 复制与完整文档导出共用字段、请求/响应和示例规则；不完整内容需确认并保留诊断。同步对象候选截断、千字段示例生成及 allOf 无类型字符串约束修复，保留作者示例、方向、授权资源图、取消与安全预算（PR #965/#967/#970/#975）。

Schema 会话改用同源 ES module Worker；部署须保留 Worker 和动态分块、允许相应 CSP 并提供正确 JavaScript MIME，失败有诊断。Go 内联配置仍按原有 CSP 方式授权。当前源码构建要求见[兼容矩阵](../reference/compatibility.md)；直接使用 module 不需要 JavaScript 运行时。

公共库仍只依赖标准库；Go 1.22、module、`Config`、`NewHandler` 与路由语义不变，独立 Gin 示例仍需 Go 1.26+。浏览器沿用 `v0.8.9`，OpenAPI 3.0/3.1/3.2 JSON 消费与资源授权边界不变，仍不接受 YAML。

## v0.8.9

相较于 `v0.8.8`，同步共享 React UI 的 Schema 示例生成修复：复用同一对象展开中的属性候选，跳过重复的完整/最小属性集合搜索，避免普通宽对象过早耗尽预算。回归覆盖 OAS 3.1/3.2 的 100 字段对象请求与响应示例；保留预算上限、取消、作者示例与校验边界（PR #950）。

公共库仍只依赖标准库，Go 1.22、module、`Config`、`NewHandler` 与路由语义保持不变；独立 Gin 示例仍需 Go 1.26+。浏览器要求沿用 `v0.8.8`（Chrome/Edge 112、Firefox 116、Safari/iOS Safari 17）；OpenAPI 3.0/3.1/3.2 JSON 消费范围不变，仍不接受 YAML。

## v0.8.8

相较于 `v0.8.7`，同步共享 React UI 的 JSONPath 特殊键名/空切片取值修复、Markdown 引用块边界修复、UTF-8 Schema 相对引用修复与深层 Schema 方向分析修复，并更新国际化、拖动及清洗依赖。内嵌资产与 React 构建保持一致。

**浏览器下限提高至 Chrome/Edge 112、Firefox 116、Safari/iOS Safari 17**，因为 JSONPath 11 需要原生 RegExp `v`；不提供旧浏览器补齐，也不声称所有最低版本均已实测。详见[兼容矩阵](../reference/compatibility.md#浏览器基线)。

公共库仍只依赖标准库，Go 1.22 基线、module、`Config`、`NewHandler` 与路由语义保持不变；独立 Gin 示例仍需 Go 1.26+。OpenAPI 3.0/3.1/3.2 JSON 消费范围不变，仍不接受 YAML。

## v0.8.7

Go 1.22 基线、module 路径、`Config`、`NewHandler` 与路由语义保持不变。
相较于 `v0.8.6`，共享 React UI 在 Schema 字段说明列展示枚举和默认值，避免长枚举展开后重复显示摘要（PR #876）；OAS3 编译工具通过双别名迁移至 TypeScript 7，保持 UI 编译目标与公开 API（PR #878）。重新构建并同步内嵌 UI 资产。
公共库仍只依赖标准库；仓库内独立 Gin 示例更新依赖并要求 Go 1.26+，不会向库消费者传递示例依赖（PR #875）。

## v0.8.6

Go 1.22 基线、module 路径、`Config`、`NewHandler` 与路由语义保持不变。
相较于 `v0.8.5`，共享 React UI 更新同主版本依赖与 docx，并迁移 React Router 7、Vite 8、React 19 和 Ant Design 6；适配页签滚动及外部资源面板组件（PR #843、#847、#849、#851、#853、#861、#864、#865）。OAS3 开发工具迁移至 ESLint 10，UI 同步要求 Node 22.13+ 或 24+。OAS3 三个工作区统一使用 TypeScript 6.0.3，core 输出目标由 ES5 调整为 ES2015，不再提供 ES5 降级输出；包入口、公开 API 与 Vite UI 编译目标保持（PR #867）。本版本不升级 Go 依赖。

## v0.8.5

Go 1.22 基线、module 路径、`Config`、`NewHandler` 与路由语义保持不变。
相较于 `v0.8.4`，共享 React UI 修复调试正文格式化与快照写入，并收敛表单状态和测试边界（PR #837）。

## v0.8.4

Go 1.22 基线、module 路径、`Config`、`NewHandler` 与路由语义保持不变。
相较于 `v0.8.3`，共享 React UI 统一 JSON 示例与预览层级折叠，并修正请求预览词法保真与空容器折叠（PR #833）。

## v0.8.3

Go 1.22 基线、module 路径、`Config`、`NewHandler` 与路由语义保持不变。
相较于 `v0.8.2`，共享 React UI 修复 OAS 3.2 标签 Tooltip 重复名称（PR #826）、改进 OAS 3.2 文档 Schema 元校验错误定位（PR #828）、普通 JSON 示例默认展示逻辑数据并保留发送原文入口（PR #827），以及调试 JSON 响应折叠、字段说明列与等价 cURL 排版（PR #830）。

## v0.8.2

Go 1.22 基线、module 路径、`Config`、`NewHandler` 与路由语义保持不变。
相较于 `v0.8.1`，共享 React UI 修复 OAS 3.2 标签菜单重复名称（PR #817）、首页服务地址明细默认折叠（PR #818），以及窄窗口首页统计卡片与外壳横向溢出（PR #820）。

## v0.8.1

Go 1.22 基线、module 路径、`Config`、`NewHandler` 与路由语义保持不变。
相较于 `v0.8.0`，共享 React UI 修复 OAS 3.1 SchemaEngine 元校验失败后再次评估可能错误放行
（PR #810）。

## v0.8.0

Go 1.22 基线、module 路径、`Config`、`NewHandler` 与路由语义保持不变。
相较于 `v0.7.1`，共享 React UI 发布 OpenAPI 3.2.x 消费：独立解析、资源图、Schema 会话、
QUERY / 自定义方法、离线导出、变化协议 `oas3.2-v1`，以及调试页 Server 解析详情默认收起
（总路线 #767，验收 PR #807）。入口仍不接受 YAML。

## v0.7.1

Go 1.22 基线、module 路径、`Config`、`NewHandler` 与路由语义保持不变。
相较于 `v0.7.0`，共享 React UI 修复 OAS 3.1 非 ASCII 分组名下入口文档自引用 `$ref`
与 retrieval URI 身份错配，避免整篇接口降级（PR #798）。

## v0.7.0

Go 1.22 基线、module 路径、`Config`、`NewHandler` 与路由语义保持不变。
相较于 `v0.6.0`，共享 React UI 新增：

- OAS 3.1 浏览器登录会话调试：可复用浏览器会话，旧缓存保持手填模式；默认同源，跨 origin 需显式 `include`、服务端凭据 CORS 与浏览器策略允许。Cookie 值不写入预览或历史，cURL 需另行配置会话，手填 Cookie 真实发送仍阻断（PR #763）。
- 枚举下拉框输入过滤（PR #757）与接口目录当前分组标题吸顶（PR #762）。
- Schema 根节点与真实 `items` 字段的标签区分（PR #761）。

完整会话语义与限制见 [OpenAPI 3.1 支持与迁移](../guide/openapi31.md)。

## v0.6.0

Go 1.22 基线、module 路径、`Config`、`NewHandler` 与路由语义保持不变。
内嵌 React UI 新增以下能力，已有 OAS 3.0.x 路径继续保留：

- OAS 3.1 与 JSON Schema 2020-12 字段树和模型，保留作者示例，并在预算内生成经校验的候选示例。
- 参数与 JSON、urlencoded、multipart 请求体的 Schema 校验和编码，以及非阻断的 JSON 响应诊断。
- 对已发现的精确 URI 授权后加载跨文档资源，以同一不可变资源图支持解析、诊断、导出和变化提示。
- 在完整资源图下导出可移植的单接口 OpenAPI JSON；HTML、Markdown、DOC、DOCX 使用同一离线快照；`paths` 操作的变化指纹与 OAS 3.0 基线隔离。
- 修复长 FQN 类型挤压字段列及悬浮预览溢出，并补齐资源消费、编码锚点导出和示例缺失诊断。

外部资源默认拒绝，SchemaEngine 只使用已登记的资源，不自行联网；不执行未知方言或自定义词汇。
显式 Cookie 参数仅支持预览和 cURL，浏览器真实发送前阻断；不提供 Cookie jar 写入、主动 Webhook 调用
或 `mutualTLS` 客户端证书注入。完整能力与浏览器限制见 [OpenAPI 3.1 支持与迁移](../guide/openapi31.md)。

已合并改动包括示例 [#715](https://github.com/songxychn/knife4j-next/pull/715)、
资源图 [#727](https://github.com/songxychn/knife4j-next/pull/727)、
表单 [#728](https://github.com/songxychn/knife4j-next/pull/728) / [#730](https://github.com/songxychn/knife4j-next/pull/730)、
单接口导出 [#732](https://github.com/songxychn/knife4j-next/pull/732) / [#733](https://github.com/songxychn/knife4j-next/pull/733)、
离线导出 [#734](https://github.com/songxychn/knife4j-next/pull/734)、
变化提示 [#736](https://github.com/songxychn/knife4j-next/pull/736)、
FQN 展示 [#731](https://github.com/songxychn/knife4j-next/pull/731)，以及
Schema 预扫描 [#743](https://github.com/songxychn/knife4j-next/pull/743) 和
后续语义修复 [#750](https://github.com/songxychn/knife4j-next/pull/750)。

## v0.5.0

Go `Handler` API 与路由语义保持不变，内嵌 React UI 新增页签左右关闭、响应状态概要、
Knife4j 本地数据安全清理、单接口 OpenAPI 3.0.x 下载，以及按分组隔离的接口新增/变化提示。

## v0.4.2

Go `Handler` API 与路由语义保持不变，内嵌 React UI 修复动态参数开关未接入表单请求体
的问题；开启后，urlencoded 与 multipart Body 可以添加 OpenAPI 未声明的文本字段，
并在预览、真实请求、缓存、历史与重置间保持一致。

## v0.4.1

Go `Handler` API 与路由语义保持不变，内嵌 React UI 恢复 HTML、DOC、DOCX 与整篇
Markdown 离线导出中的请求示例和响应示例，并覆盖显式 example、named example、本地
引用与 schema 生成回退。

## v0.4.0

Go `Handler` API 与路由语义保持不变，内嵌 React UI 支持对当前可见的 Path、Query、
Header 与 Cookie 参数批量选择；HTML、DOC、DOCX 与整篇 Markdown 共用一致的离线
导出内容模型，Word 导出提供 `tag -> API` 两级大纲与原生编号。

## v0.3.0

Go `Handler` API 与路由语义保持不变，内嵌 React UI 同步新能力：请求参数支持“全部分组”
和“当前分组”两级作用域；请求参数、Cookie 会话与 OpenAPI 鉴权拆分为独立页面，
Cookie 与鉴权仍严格按分组隔离。
