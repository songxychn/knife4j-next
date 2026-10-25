# Boot 2 Demo 旧组件安全评估（2026-10-25）

对应 [#956](https://github.com/songxychn/knife4j-next/issues/956)。本记录针对仓库默认配置及 Demo 的运行时依赖，不能代替线上部署审计，也不是“Boot 2 无漏洞”声明。复核起点为 master `70b2a2e1196b4ffd1644b91511322cfe7c9d46dc`。

## 兼容范围与本次修补

保留 Boot 2.7.18、Java 8 运行兼容、Springfox 2.10.5、SLF4J 1.7.36、Tomcat 9.0.123、Jackson 2.18.12，以及文档、JSON、multipart 全部 Demo 功能。仅在此不可发布的 Demo POM 中管理版本；发布的 starter 和消费方 BOM 不会因此获得相同修补。

| 组件 | 原版本 → 本次版本 | 修补与输入边界 |
| --- | --- | --- |
| Spring Framework 全组 | 5.3.31 → 5.3.39 | 同一 5.3 BOM 对齐；包含 URL host 解析 CVE-2024-22243/22259/22262、条件请求 CVE-2024-38809、SpEL CVE-2024-38808 修补。Demo 没有用户 URL 白名单后转发、用户 SpEL 或自定义 ETag 端点；静态资源走 Last-Modified，不能把库级问题写成已证实的公网利用。 |
| Logback classic/core | 1.2.12 → 1.2.13 | 回补 CVE-2023-6378/6481 的对象深度/数组过滤，**仅 Java 9+ 生效**。Java 8 仍有该风险；默认日志不启用 receiver。 |
| SnakeYAML | 1.30 → 1.33 | 覆盖 CVE-2022-25857、38749/38750/38751/38752、41854 的资源耗尽修补；启动 YAML 的嵌套深度测试转绿。CVE-2022-1471 仍须按下文处理。 |
| Log4j API / to-slf4j | 2.17.2 → 2.25.5 | CVE-2026-49844：MapMessage 的非有限浮点数现在能输出合法 JSON；桥接同步版本，继续使用 SLF4J 1.7。没有引入 log4j-core。 |
| ClassGraph | 4.1.7 → 4.8.112 | 最小已修复版本消除 CVE-2021-47621 的版本探测 XXE。触发点是展开的类目录附近的本地 pom.xml；不是上传文件解析。正常打包运行使用 JAR。 |

依据：[Spring 最终公开 5.3.39](https://spring.io/blog/2024/08/14/spring-framework-6-1-12-6-0-23-and-5-3-39-available-now/)、[URL 公告](https://spring.io/security/cve-2024-22243/)、[条件请求公告](https://spring.io/security/cve-2024-38809/)、[SpEL 公告](https://spring.io/security/cve-2024-38808/)、[Logback 回补说明](https://logback.qos.ch/news-archive.html)、[SnakeYAML 公告](https://github.com/advisories/GHSA-3mc7-4q67-w48m)、[Apache Log4j 公告](https://logging.apache.org/security.html)、[ClassGraph 上游修补](https://github.com/classgraph/classgraph/pull/539)。

## 仍需保留的风险

以下“未发现触发路径”仅指本仓库默认 Demo。启动参数、外部配置、代理和部署平台改变时，需要重新核验。

### 需要部署侧确认或维护者决策

后续核验和处置决策由 [#957](https://github.com/songxychn/knife4j-next/issues/957) 承接；本次修补不会关闭这些剩余风险。

- **multipart 与 WAF/代理：CVE-2026-41853。** Demo 的两个上传接口接受 multipart，因此满足前两个条件。如果前置 WAF/代理会解析 multipart 内容并据此做安全检查，还存在解析差异绕过风险。普通上传成功测试不能排除它。本轮没有核验线上代理策略，结论是“条件性风险未排除”。Spring 5.3 的官方修补为商业支持的 5.3.49；不能用公开 5.3.39 宣称修复，也不能把限制文件大小当作此漏洞的补丁。[官方条件与版本](https://spring.io/security/cve-2026-41853/)
- **Java 8 的 Logback receiver：CVE-2023-6378/6481。** 1.2.13 不为 Java 8 安装该对象过滤器。源码默认配置没有 receiver；如外部配置启用并对不可信端开放，仍可能被拒绝服务攻击。Java 17 测试通过不代表 Java 8 修复。[官方说明](https://logback.qos.ch/news-archive.html)
- **旧支持线无法靠公开补丁清零。** Spring 5.3.39 是公开 5.3 线的最后版本，Logback 1.2 已结束维护。选择商业回补需要确认授权、版本和兼容验证；切换到受支持 Boot/日志栈涉及 Java、javax/jakarta、SLF4J 或 Springfox 边界，必须单独决策。本轮没有擅自替换完整 Boot 2 Demo。[Spring 支持范围](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-Versions)、[Logback 支持范围](https://logback.qos.ch/news.html)

### 配置、日志与本地文件路径

| 公告 | 核对结果与边界 |
| --- | --- |
| SnakeYAML CVE-2022-1471 | 1.33 的通用 `Constructor` 仍不安全。Boot 2.7.18 的 `OriginTrackedYamlLoader` 使用 `SafeConstructor`；测试确认拒绝 Java 全局标签。Demo 没有任意 YAML 导入接口，上传只读取文件名/大小并返回元数据。**不能**把通用 `new Yaml().load(untrusted)` 当作安全 API，也不能允许不可信方写启动配置。Boot 还把 collection alias 上限设为 Integer.MAX_VALUE，因此本报告不声称它对任意恶意 YAML 有全面资源限制。[Boot 源码](https://github.com/spring-projects/spring-boot/blob/v2.7.18/spring-boot-project/spring-boot/src/main/java/org/springframework/boot/env/OriginTrackedYamlLoader.java) |
| Logback CVE-2026-10532、9828 | 公告涉及对象反序列化白名单边界；1.2.13 仍有版本命中。Demo 没有配置 SimpleSocketServer、SimpleSSLSocketServer 或 receiver，也不接收序列化日志。不能宣称底层库已修复。[上游发布说明](https://logback.qos.ch/news.html) |
| Logback CVE-2024-12798、12801、2025-11226、2026-1225、13006 | 需要日志 XML/启动环境被控制，部分还需要 Janino。默认运行依赖没有 Janino，仓库没有外部 logback XML；默认控制台日志不提供此输入。控制部署配置的权限仍是边界，12801 的恶意 DTD SSRF 不能仅凭“没有 Janino”排除。[2024 公告说明](https://logback.qos.ch/news-archive.html)、[后续公告](https://logback.qos.ch/news.html) |
| Logback CVE-2026-19880、104721 | 官方新公告涉及 MDCBasedDiscriminator/SiftingAppender 的目标路径控制。默认 Demo 没有按用户 MDC 分割文件的配置；没有把升级至 1.2.13 当成这些新公告的修补。[官方说明](https://logback.qos.ch/news.html) |
| Boot CVE-2026-40973 | 可预测的本地临时目录与持久化 session 恢复有关；默认未启用 `server.servlet.session.persistent`，没有自行加载序列化 session。外部启用持久化或共享可写临时目录后必须重评。[官方公告](https://spring.io/security/cve-2026-40973/) |
| Boot CVE-2026-41001 | 运行依赖无 Artemis，未启用嵌入式 broker 自动配置。[官方公告](https://spring.io/security/cve-2026-41001/) |
| Boot CVE-2025-22235 | 无 Actuator、Spring Security 或 `EndpointRequest.to()` 安全匹配器。[官方公告](https://spring.io/security/cve-2025-22235/) |

### Spring 后续公告的 HTTP 与表达式路径

5.3.39 之后的这些公告仍需保留，不向后推断“版本安全”。下表按触发机制分组，逐项对应本次源码/运行依赖；版本及完整条件以各官方公告为准。

| 公告 | 默认 Demo 的结论 |
| --- | --- |
| [CVE-2024-38820](https://spring.io/security/cve-2024-38820/)、[2025-22233](https://spring.io/security/cve-2025-22233/) | `PageQuery` 存在正常属性绑定，但没有通过 `disallowedFields` 实现敏感字段保护的绑定器；不能把“存在绑定”直接等同于该绕过。 |
| [CVE-2025-41249](https://spring.io/security/cve-2025-41249/) | 没有 Spring Security 方法授权或依赖泛型继承注解检测的鉴权链。 |
| [CVE-2026-41848](https://spring.io/security/cve-2026-41848/) | 路由 pattern 来自固定注解和固定 Swagger selector；请求控制的是 path，不是传入 AntPathMatcher 的 pattern。 |
| [CVE-2026-41849](https://spring.io/security/cve-2026-41849/)、[41850](https://spring.io/security/cve-2026-41850/)、[41851](https://spring.io/security/cve-2026-41851/)、[41852](https://spring.io/security/cve-2026-41852/) | 没有用户表达式进入 SpEL 求值器的路径。启动配置解析不等于公开 SpEL API。 |
| [CVE-2026-41841](https://spring.io/security/cve-2026-41841/)、[22741](https://spring.io/security/cve-2026-22741/) | 实际启动后的 resource handler 仅使用 PathResourceResolver；没有共享资源解析缓存、受保护/公开缓存混用或 encoded resolver。回归测试锁定这一边界。 |
| [CVE-2026-41842](https://spring.io/security/cve-2026-41842/)、[41843](https://spring.io/security/cve-2026-41843/) | 未配置 VersionResourceResolver，不满足文件系统 + 版本化静态资源的组合条件。 |
| [CVE-2026-22745](https://spring.io/security/cve-2026-22745/) | 仅在 Windows + 文件系统静态资源时触发。仓库默认文档资源来自 WebJar，本轮在 macOS 验证；没有验证 Windows 外置资源部署，不能推广为全平台已缓解。 |
| [CVE-2025-41242](https://spring.io/security/cve-2025-41242/) | 默认嵌入式 Tomcat 未禁用路径安全检查，符合上游列出的排除条件；若改容器/相关安全配置，需重评。 |
| [CVE-2024-38816](https://spring.io/security/cve-2024-38816/)、[38819](https://spring.io/security/cve-2024-38819/) | 没有 RouterFunctions 的 FileSystemResource 功能式资源映射。 |
| [CVE-2024-38828](https://spring.io/security/cve-2024-38828/) | `@RequestBody` 接收具体 JSON DTO，没有 `byte[]` 参数；multipart 的 MultipartFile 不等同于该公告的字节数组参数。 |
| [CVE-2026-41844](https://spring.io/security/cve-2026-41844/)、[22737](https://spring.io/security/cve-2026-22737/)、[47884](https://spring.io/security/cve-2026-47884/) | 没有攻击者控制路径的隐式视图名、脚本视图或 XSLT 视图；根路径仅固定 `redirect:/doc.html`，其余接口返回 JSON。 |
| [CVE-2026-41845](https://spring.io/security/cve-2026-41845/)、[41846](https://spring.io/security/cve-2026-41846/) | 没有使用 JavaScriptUtils 生成用户脚本，未引入 JSP/JSTL 表单渲染。 |
| [CVE-2026-22735](https://spring.io/security/cve-2026-22735/)、[59313](https://spring.io/security/cve-2026-59313/) | 没有 SseEmitter 或功能式 SSE 端点。 |
| [CVE-2016-1000027](https://github.com/advisories/GHSA-4wrc-f8pq-fpqp) | 没有 HttpInvokerServiceExporter 或接收 Java 序列化对象的 remoting 映射。存在 spring-web JAR 不等于暴露 remoting。 |

## 核对方法与回归证据

- 对 Maven runtime tree 中的第三方坐标按精确版本查询 GitHub Global Security Advisories（Maven ecosystem），再与 Spring、Logback、Apache 公告及实现路径核对。官方新增公告补充了数据库未命中的条目，例如 Spring 功能式 SSE 和 Logback MDC 路径问题。数据库未命中不是安全证明，也不是完整的渗透测试。
- 其他核对的旧组件包括 Springfox 各模块、Byte Buddy 1.9.10、ClassMate 1.4.0、MapStruct 1.3.1.Final、Spring Plugin 2.0.0.RELEASE、Javassist 3.30.2-GA、Swagger 1.6.14、SLF4J 1.7.36、annotation API 1.3.5；当次按坐标查询无匹配公告，因此未无理由扩大升级。前轮 Tomcat/Jackson 修补版本也复核无匹配公告。
- `DependencySecurityTest`：原依赖 6 项中 4 failures + 1 error；修补后 JDK 17 全过。测试仅构造有界数据：畸形 URL、100 层 YAML、40 层 ArrayList、NaN/Infinity JSON，以及临时 marker 文件的外部实体。不会访问线上服务或真实敏感文件。
- Java 8：Maven/格式化插件按要求运行在 JDK 17，Surefire 明确使用 JDK 8 子进程；5 个 HTTP/配置测试 + 5 个依赖测试通过，1 个 Java 9+ Logback 过滤测试按官方限制跳过。不能将构建工具最低 JDK 与产物运行兼容混为一谈。
- 完整门禁和独立审查、CI 的当前 head 证据记录在关联 PR；本记录不代替每次新 push 后的验证。

在仓库根目录运行标准门禁：

```sh
JAVA_HOME=/path/to/jdk17 ./tools/test-java.sh
```

在 `knife4j/` 运行定向安全与 Java 8 运行验证：

```sh
JAVA_HOME=/path/to/jdk17 mvn -B -ntp -pl knife4j-demo-openapi2 -am \
  -Dknife4j-skipTests=false -Dtest=DependencySecurityTest,DemoSecuritySmokeTest \
  -Dsurefire.failIfNoSpecifiedTests=false -Djvm=/path/to/jdk8/bin/java verify
```

运行依赖核对：

```sh
mvn -B -ntp -pl knife4j-demo-openapi2 dependency:tree -Dscope=runtime
```

本轮没有发布、部署或修改线上策略。完整 Demo 继续保留；任何上线都仍需核对外部日志配置、session 持久化、静态资源设置及 multipart WAF/代理条件。
