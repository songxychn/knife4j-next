# 从 upstream 迁移

`knife4j-next` 保留与 upstream `xiaoymin/knife4j` 一致的 `artifactId`、Java 包名（`com.github.xiaoymin.knife4j.*`）、YAML 配置键和 `doc.html` 访问入口，仅将 Maven `groupId` 切换为 `com.baizhukui`。

## 坐标替换示例

```xml
<!-- Before -->
<dependency>
    <groupId>com.github.xiaoymin</groupId>
    <artifactId>knife4j-openapi3-jakarta-spring-boot-starter</artifactId>
    <version>4.5.0</version>
</dependency>

<!-- After -->
<dependency>
    <groupId>com.baizhukui</groupId>
    <artifactId>knife4j-openapi3-jakarta-spring-boot-starter</artifactId>
    <version>5.2.4</version>
</dependency>
```

完整的版本对照、验证清单与回滚指引见文档站 [从 upstream 迁移](../docs/guide/migration.md)。
