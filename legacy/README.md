# legacy

冻结或非主线维护的历史代码。**不要在此目录实现新功能或接 agent 常规任务。**

| 子目录 | 原路径 | 说明 |
|---|---|---|
| `vue2/` | `knife4j-vue/` | upstream Vue 2 UI，仅作行为参考 |
| `insight/` | `knife4j-insight/` | 上游独立聚合方案，开源侧不再维护 |
| `sandbox/` | `sandbox/` | 本地试验/沙箱 |

CI 与发布流水线**不**构建本目录。活跃前端见 `front/`，Java 见 `knife4j/`。
