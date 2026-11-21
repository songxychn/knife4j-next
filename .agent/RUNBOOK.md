# 运行手册

使用与改动匹配的**最窄**验证，小改动不必默认跑全套。

## 环境

- Java：JDK 17（`.java-version`）
- JS 工具链：Bun `1.4.x`（最低 `1.4.4`，见 `.bun-version`），安装用 `bun install --frozen-lockfile`，无需独立 Node.js。
- CI：`.github/workflows/build.yml`（PR / master）、`release.yml`（Java 发布）、`deploy-demo.yml`（由 Release 调用）。
- 浏览器下限：OAS3 React UI 为 Chrome/Edge 112、Firefox 116、Safari 17；OAS2 Vue3 为 Chrome/Edge 117、Firefox 119、Safari 17.4。

## 验证命令

| 改动 | 命令 |
|---|---|
| `knife4j/**` | `./tools/test-java.sh` |
| `front/schema-engine` / `core` / `ui-react` | `./tools/test-front-core.sh` |
| `front/vue3` | `./tools/test-vue3.sh` |
| `docs/**` | `./tools/test-docs.sh` |
| `knife4x/go/**` / `knife4x/examples/gin/**` | `./tools/test-knife4x-go.sh` |
| 全区域验收 | `./tools/test-all.sh` |

- 根 POM 默认 `knife4j-skipTests=true`，勿用裸 `mvn verify` 替代 `./tools/test-java.sh`。
- 增删 `knife4j-smoke-tests/` 子模块时同步更新 `knife4j-smoke-tests/pom.xml` 的 `<modules>`，`tools/smoke-evidence.sh` 会自动核对。
- Schema Worker 浏览器门禁（前端构建后）：
  ```bash
  bun front/ui-react/scripts/run-schema-example-worker-acceptance.mjs --smoke --static-root front/ui-react/dist
  ```

## Bug 复现

1. **先验证附件规范**：附带 OpenAPI / Swagger JSON/YAML 时，先按声明版本校验结构与语义；违反规范或无法表达意图的文档不作为 bug 契约，要求报告者修正，禁止为接受非法文档加 alias 或猜测转换（若触发崩溃/安全问题，只修安全拒绝）。
2. **先复现再修**：在未打补丁基线留下失败证据（smoke test / 失败单测 / 命令输出），修复后同一证据转绿。复现不到则标 `status:blocked` 等补充信息。
3. **upstream 关联**：读完原 issue 与评论再定范围；仅做衍生增强时不宣称已修复 upstream。

## 正式发布验收

须维护者明确授权后再创建/推送 tag。当前具备正式发布流程的语言为 **Java** 与 **Knife4x Go**（版本号各自独立）。

### 发布文案
发布准备 PR 同步更新 `README.md`、接入/迁移示例、发布说明等当前入口版本号，移除“待发布”等准备态文案。`tools/verify-current-version-docs.py` 校验 Maven 坐标与发布说明“最新”标记。

### Java 完成条件
- `vX.Y.Z` annotated tag 已推送
- `Release` workflow（含随后的 `deploy-demo` job）全部成功
- Maven Central 目标构件可访问
- GitHub Release 存在且正文与 `docs/release-notes/index.md` 对应小节一致

### Go 完成条件
按 [knife4x/go/RELEASE.md](../knife4x/go/RELEASE.md) 推送 `knife4x/go/vX.Y.Z` tag，并确认公共 Go proxy、`sum.golang.org` 与全新 consumer 消费通过。
