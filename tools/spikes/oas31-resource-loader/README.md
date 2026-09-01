# OAS 3.1 跨文档资源加载安全契约探针

本目录是 issue [#704](https://github.com/songxychn/knife4j-next/issues/704) 的隔离
spike。它验证浏览器安全边界并冻结后续 #705 的产品契约，**不是生产 loader**，也不会
修改 `SchemaDocumentSession`、`SchemaEngine` 或当前 registry-only 行为。

## 运行

前置：Bun、Chrome/Chromium。探针会自动查找常见浏览器路径；非标准路径可通过
`CHROME_BIN` 指定。

```bash
./tools/test-oas31-resource-loader-spike.sh
```

该命令先跑纯策略测试，再启动四个随机端口的 loopback HTTP 服务和一个全新无头浏览器
上下文。不会读取现有 Chrome profile、Cookie 或登录状态。`playwright-core` 只负责驱动
本机浏览器，不下载浏览器二进制。

## 探针覆盖

- 同源页面确实持有测试 Cookie 时，资源请求仍使用 `credentials: "omit"`，不发送
  Cookie、Authorization 或 Referer；资源响应设置的 Cookie 也不会被浏览器接受。
- 允许的跨域目标仍必须通过 CORS；CORS 失败的 GET 会到达服务端，但响应对页面不可见。
- CSP 未允许的目标在请求到达服务端前被阻断。
- `redirect: "error"` 只请求 3xx 源，不请求 Location 目标。
- `AbortSignal` 会取消流式响应；单资源字节上限会在读取期间生效。
- 外部文档 A → B → A 只各取一次并记录循环。
- 文档数预算在调度下一个请求前生效。
- 未知 Content-Type 不进行 body sniffing。

## 预期网络清单

随机端口在输出中归一化为四个名字。`page:/probe.js` 是探针自身脚本，不属于资源
loader 请求。

| 目标 | 服务端收到 | 说明 |
|---|---:|---|
| `page:/credential-check.json` | 1 | 同源、无 ambient credentials/referrer |
| `allowed:/cors-ok.json` | 1 | CORS 成功 |
| `no-cors:/cors-blocked.json` | 1 | GET 已发出，响应被 CORS 隐藏 |
| `csp-blocked:/csp-blocked.json` | 0 | CSP pre-request 阻断 |
| `allowed:/redirect.json` | 1 | 3xx 源 |
| `allowed:/redirect-target.json` | 0 | 禁止跟随 redirect |
| `allowed:/slow.json` | 1 | 随后由 AbortSignal 取消 |
| `allowed:/oversize.json` | 1 | 读取前/中命中字节预算 |
| `allowed:/wrong-content-type` | 1 | 响应因媒体类型被拒绝 |
| `allowed:/cycle-a.json` | 1 | 循环图节点 A |
| `allowed:/cycle-b.json` | 1 | 循环图节点 B |
| `allowed:/budget-a.json` | 1 | 预算图第一个节点 |
| `allowed:/budget-b.json` | 0 | 在调度前被资源数预算拒绝 |

`Accept` 值刻意保持为 111 字节的 CORS-safelisted 请求头；探针必须没有 OPTIONS
预检。浏览器对 CORS、CSP、redirect、TLS 和普通网络失败都可能只暴露不透明的
`TypeError`，稳定错误码因此统一为 `RESOURCE_FETCH_BLOCKED`，不得猜测具体原因。

完整结论、生产接口草案和测试矩阵见 [DECISION.md](./DECISION.md)。

自 #705 起，浏览器探针直接打包并执行生产 `externalResourcePolicy.ts`，并用生产
`ExternalResourceLoader` 验证精确授权项会请求一次、同图未授权项保持零请求；循环和图预算夹具仍由
本目录的最小图探针提供。这样 CSP、CORS、redirect、credentials、取消、decoded-byte 与 exact grant
证据不会只覆盖一份与产品脱离的策略副本。
