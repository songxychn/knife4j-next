# JSON Schema 2020-12 引擎接入决策

- 状态：phase 0 通过，允许进入独立的 phase 1 实现设计
- 日期：2026-08-30
- 任务：[issue #683](https://github.com/songxychn/knife4j-next/issues/683)
- 前置：[PR #682](https://github.com/songxychn/knife4j-next/pull/682) 合并后才能接入产品运行时

## 决策

Knife4j 不自行实现 JSON Schema validator。下一阶段可以采用
`@hyperjump/json-schema`，但必须封装在 Knife4j 自有的现代 ESM
`SchemaEngine` 适配层后面，并默认采用仅内存 registry、禁止外部资源加载的策略。

这里的“完整”限定为：对 JSON Schema Draft 2020-12 标准 vocabularies 与
OpenAPI 3.1 base dialect 正确执行 Schema Resource、URI、动态作用域、求值、
validation 和 annotations 语义。它不表示执行任意未知 vocabulary，也不表示把
任意 Schema 无损压成唯一字段树。规范求值、Schema 图读取、字段树投影和示例生成
必须是四个不同的内部概念。

依据：

- [JSON Schema 2020-12 Core](https://json-schema.org/draft/2020-12/json-schema-core)
- [OpenAPI 3.1.1](https://spec.openapis.org/oas/v3.1.1.html)
- [Hyperjump JSON Schema](https://github.com/hyperjump-io/json-schema)

## 探针结果

固定版本：

- `@hyperjump/json-schema@1.17.8`
- `@hyperjump/browser@1.5.0`
- Bun 1.4.0

`./tools/test-json-schema-engine-spike.sh` 当前覆盖并通过：

- 跨资源 `$dynamicAnchor` / `$dynamicRef` 与有限实例递归
- `$id`、嵌入 Schema Resource、`$anchor` 和 boolean schema
- `unevaluatedProperties`、`prefixItems` / `unevaluatedItems`
- 基于实际成功求值分支收集 annotations
- registry 内的 compound schema bundling
- OpenAPI 3.1 整文档校验与 springdoc 风格 Schema Object 求值
- 未注册外部引用在调用 `fetch` 前被资源策略拒绝
- 未知 OpenAPI dialect 明确拒绝，不猜测 vocabulary

浏览器构建结果：

| 指标 | 结果 |
|---|---:|
| minified ESM | 150,650 bytes |
| gzip -9 | 24,343 bytes |
| `eval` / `new Function` | 0 |
| Node 内置导入 | 0 |

Headless Chrome 152 实测页面使用以下 CSP，仍能完成动态引用求值：

```text
default-src 'none'; script-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'
```

网络记录只有本地 `index.html` 与 `browser-probe.js`。这个结论只覆盖本探针的
import graph；不能外推到 Hyperjump 的所有可选 format、plugin 或未来版本。每次
升级依赖都必须重新执行 CSP 页面和静态扫描。

合成宽对象的单机结果如下。它们用于发现数量级风险，不是性能承诺：

| properties | Schema 大小 | 注册 | 编译 | 单次校验 |
|---:|---:|---:|---:|---:|
| 250 | 14,052 B | 0.39–0.49 ms | 18.33–19.44 ms | 0.24–0.27 ms |
| 2,500 | 146,802 B | 3.10–3.45 ms | 51.29–52.44 ms | 1.71–1.84 ms |
| 10,000 | 596,802 B | 10.33–10.60 ms | 179.27–186.01 ms | 6.97–8.28 ms |

环境为 macOS arm64 / Bun 1.4.0，连续四次本地运行；正式实现需要增加真实 Springdoc 文档、
深递归、组合分支和内存峰值测试。

## 为什么选择 Hyperjump 作为首选

Hyperjump 同时提供 Draft 2020-12、OpenAPI 3.1 dialect、Schema registry、
compound bundling、浏览器构建和非 validation 工具入口。本探针验证了 Knife4j
当前最缺失的动态作用域与 Schema Resource 语义。

其他候选仍保留为退出路径：

| 候选 | 适合点 | 当前缺口 |
|---|---|---|
| [Ajv](https://ajv.js.org/) | validation、错误输出与生态成熟 | 主要面向 validation/code generation，不直接提供 Knife4j 所需的 Schema Resource 图和 UI 遍历层；默认代码生成还需单独处理严格 CSP |
| [json-schema-library](https://github.com/sagold/json-schema-library) | 遍历、数据生成与 2020-12 支持 | 没有内建 OpenAPI 3.1 dialect，需要自建 dialect/annotation 映射；维护面较集中 |
| [Scalar OpenAPI Parser](https://github.com/scalar/scalar/blob/main/packages/openapi-parser/README.md) | OpenAPI 文档解析、dereference 与 bundling | 不能作为完整 JSON Schema 引擎；当前仍有公开的 [`$dynamicRef` 问题](https://github.com/scalar/scalar/issues/9414) |

[Bowtie](https://bowtie.report/) 只作为官方测试集兼容性的方向性信号；其 issue
计数包含可选、未实现或运行问题，不能直接当作库质量排名。

## 必须由适配层吸收的风险

1. **实验性 API**：Schema 图读取和 annotations 使用 Hyperjump 的
   `experimental` exports，可能在 minor 版本变化。产品代码只能依赖 Knife4j
   自有接口，并固定精确依赖版本。
2. **全局状态**：Hyperjump 的 registry、dialect 与 URI scheme plugin 是模块级
   状态。适配层必须管理文档生命周期、稳定 retrieval URI、冲突检测与清理，不能
   让页面组件直接注册/注销。
3. **嵌入资源索引**：嵌入式 `$id` 资源保留在根文档的 browser context，不自动
   成为可独立检索的全局 registry 项。探针用受限回退查找证明可行；产品实现应在
   注册时建立 `resource URI -> document context` 索引，避免 O(n) 扫描。
4. **annotation 依赖实例**：annotation 来自一次实际求值，不能只凭 Schema 静态
   读取。字段说明等静态 UI 信息应读取 Schema 图；调试校验结果再读取 evaluation
   annotations。
5. **默认网络能力**：上游默认启用 HTTP、HTTPS 和文件读取。Knife4j 必须在处理
   用户文档前移除这些 scheme。未来加载器采用显式 opt-in，并限制同源/白名单、
   credentials、content type、字节数、资源数、深度、时间、取消和缓存。
6. **编译缓存**：直接 `validate(uri, instance)` 会重复编译。产品层需要按文档身份、
   dialect 和 canonical URI 缓存 validator，并在文档卸载时失效。
7. **资源耗尽**：规范允许递归和高组合复杂度。网络限制不能替代求值预算；还需要
   节点数、分支数、实例深度、执行时间与可取消策略。

## 下一阶段边界

phase 1 只建立 `front/schema-engine` ESM workspace 与内部 API：

```ts
interface SchemaEngine {
  registerDocument(document: unknown, retrievalUri: string): Promise<void>
  resolve(schemaUri: string): Promise<SchemaNode>
  evaluate(schemaUri: string, instance: unknown): Promise<EvaluationResult>
  unregisterDocument(retrievalUri: string): void
}
```

完成条件：使用官方 2020-12 测试子集与真实 Springdoc OAS 3.1 固定夹具验证资源图、
动态作用域、错误分类、缓存失效和资源预算；默认网络请求数必须为零。

phase 1 不修改字段树、示例或调试 UI。UI 投影与受控外部引用分别进入后续 issue，
从而可以在不回退 #682 单文档消费基线的情况下独立回滚引擎接入。
