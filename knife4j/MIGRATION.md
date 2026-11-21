# Migration

This fork keeps the artifact names that exist in upstream `knife4j`, but publishes them under the `com.baizhukui` namespace. It also adds fork-only starters, such as `knife4j-openapi3-boot4-spring-boot-starter`, `knife4j-gateway-boot4-spring-boot-starter`, `knife4j-aggregation-boot4-spring-boot-starter` and `knife4j-gateway-webmvc-spring-boot-starter`; see the [module reference](../docs/reference/modules.md).

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
  <version>5.8.3</version>
</dependency>
```

The example uses current Java `5.8.3`.

## Compatibility

- Java package names remain `com.github.xiaoymin.knife4j.*`.
- Spring configuration and `doc.html` access patterns are unchanged.
- Replacing the `groupId` is intended to be a drop-in dependency change.
- For Spring Boot / springdoc / Jackson dependency floors, browser minimums, and version-specific changes, see the [compatibility matrix](../docs/reference/compatibility.md) and [release notes](../docs/release-notes/index.md).
