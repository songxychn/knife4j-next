# Migration

This fork keeps the same artifact names as upstream `knife4j`, but publishes them under the `com.baizhukui` namespace.

## Coordinates

Replace:

```xml
<dependency>
  <groupId>com.github.xiaoymin</groupId>
  <artifactId>knife4j-openapi3-spring-boot-starter</artifactId>
  <version>4.5.0</version>
</dependency>
```

With:

```xml
<dependency>
  <groupId>com.baizhukui</groupId>
  <artifactId>knife4j-openapi3-spring-boot-starter</artifactId>
  <version>5.8.0</version>
</dependency>
```

The example uses published Java `5.8.0`.

## Compatibility

- Java package names remain `com.github.xiaoymin.knife4j.*` in the first fork release.
- Spring configuration and `doc.html` access patterns are unchanged.
- The first fork release is intended to be a drop-in dependency replacement.

- In `5.7.9`, Boot3 Jakarta MVC, WebFlux and standalone aggregation use springdoc `2.9.1` and require Boot `3.4.7+` / `3.5.1+` (Framework `6.2.8`). Gateway modules retain their existing Cloud/Boot combinations.

- In `5.7.9`, browser minimums increase: OAS3 requires Chrome/Edge 112, Firefox 116, Safari/iOS Safari 17; OAS2 requires Chrome/Edge 117, Firefox 119, Safari/iOS Safari 17.4. These native API requirements are not polyfilled. Java dependencies remain those of 5.7.8. See the [compatibility matrix](../docs/reference/compatibility.md#浏览器基线) for validation limits.

- Released `5.7.10` updates the Boot4 line to Boot `4.1.2` and aligns Jackson 2 `2.22.4` / Jackson 3 `3.1.8`; `5.8.0` keeps these dependencies and the browser/Java minimums. Consumer BOMs can override transitive versions; check the [Jackson guidance](../docs/guide/faq.md#jackson-依赖告警处理).

- `5.8.0` adds a default INFO startup banner for OAS3 WebMVC (Boot2/3/4); set `knife4j.banner=false` to disable it. Shared UI Schema sessions use same-origin ES module Workers; retain Worker chunks and allow the required CSP and JavaScript MIME. Source builds require stable Node 26.x; consuming Maven artifacts requires no Node.
