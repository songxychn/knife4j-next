# OAS 3.2 文档结构夹具

本目录是 #769 的合成规范夹具，不是 springdoc 生成结果。域名均为保留的 `example.test`，测试不读取这些地址。

- 规范正文：<https://spec.openapis.org/oas/v3.2.0.html>
- 固定结构 helper：<https://spec.openapis.org/oas/3.2/schema/2025-11-23.html>
- OAS metadata 参考：<https://spec.openapis.org/oas/3.2/meta/2025-09-17.html>

`document-objects-3.2.0.json` 覆盖新增对象、所有 content 使用位置的 Media Type Reference、有序/嵌套 Encoding、SSE itemSchema、XML、defaultMapping 和 map 中合法的 x-* 名称。测试内通过有界变体隔离反例、opaque 数据和本地引用参数继承；不把无效反例作为兼容契约。

正文优先的已知 helper 差异分别有命名测试：

1. Operation.responses 与 Response.description 可选。声明了 Responses Object 时仍需状态码、范围或 default。
2. Discriminator.propertyName 仍必填；可选的是 payload 中的判别属性。meta helper 没有该 required 声明。组合 Schema 如何使判别属性必填、defaultMapping 是否匹配属于后续 Schema/多态能力。
3. 正文 Media Type Object 没有 description 字段，结构 helper 额外允许了它。Reference Object 自身的 description 注解仍合法。
4. Link.parameters 可以使用任意 literal；结构 helper 的字符串 map 约束过窄。其参数值与 requestBody 始终保持 opaque。
5. 正文的默认方言 URI 与 helper 默认值不同。本包不填充或解释任何默认方言，不执行 Schema 验证。

collector 只检查声明的结构规则。空诊断不是完整规范校验、资源可达或产品已支持 3.2 的证明。跨文档身份/加载、Schema 实例校验、媒体编解码、XML/defaultMapping 执行语义以及产品消费 gate 均由后续工作包负责。

Parameter 声明的名称按 §4.12.2.1 区分大小写。HTTP header 字段匹配规则不会在结构检查时折叠声明身份；发送请求时的字段处理属于后续调试能力。Header Object 使用自己的固定字段清单，不包含 Parameter 的 `name`、`in`、`allowEmptyValue` 或 `allowReserved`。
