---
title: 前端独立部署
---

# 前端独立部署

Knife4j 的 `doc.html` 默认嵌入在 Spring Boot 应用中。在某些场景下，你需要将前端 UI 静态资源独立部署：

- 前后端分离架构，API 服务不暴露静态资源
- 多个后端服务需要统一的文档入口
- 生产环境需要严格管控文档访问

本文介绍 OpenAPI 3 React UI 的三种部署方案。OpenAPI 2 请使用对应的 Vue3 WebJar；不能用 React UI 加载 Swagger 2 文档。

## 方案一：Nginx 反向代理

最常用的方案。Nginx 托管 Knife4j 静态文件，同时反向代理后端 API 请求。

### 架构图

```
浏览器 → Nginx (doc.html + /v3/api-docs) → 后端服务
```

### 步骤

**1. 获取前端静态文件**

从 knife4j 的 webjar 中提取前端资源：

```bash
# 在 Maven 仓库中找到 knife4j-openapi3-ui 的 jar
# 保留 webjars/ 下的目录、Worker 和动态分块
knife4j_unpack_dir="$(mktemp -d)"
unzip ~/.m2/repository/com/baizhukui/knife4j-openapi3-ui/5.8.2/knife4j-openapi3-ui-5.8.2.jar \
  "META-INF/resources/*" -d "$knife4j_unpack_dir"
mkdir -p /opt/knife4j-static
cp -R "$knife4j_unpack_dir/META-INF/resources/." /opt/knife4j-static/
```

**2. 配置 Nginx**

```nginx
server {
    listen 80;
    server_name doc.example.com;

    # 静态文件；http {} 中需 include mime.types，确保 JS/CSS MIME 正确
    location / {
        root /opt/knife4j-static;
        index doc.html;
        try_files $uri $uri/ =404;
    }

    # 代理 OpenAPI 接口
    location /v3/api-docs {
        proxy_pass http://backend:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # 自定义 springdoc.api-docs.path 时用于发现实际 swagger-config 地址
    location /knife4j/config {
        proxy_pass http://backend:8080;
        proxy_set_header Host $host;
    }
}
```

::: tip 后端配置
浏览器经同一个 Nginx origin 读取文档时无需 CORS。若自定义了 `springdoc.api-docs.path`，还需代理该实际路径。接口调试使用文档中的 `servers` 或 UI Host 覆盖：目标跨 origin 时，目标服务必须允许相应 CORS；要走同源代理，则须另行代理真实业务路径。
:::

### 多服务聚合

React UI 不读取 `group.json`。可以在默认发现入口 `/v3/api-docs/swagger-config` 返回一个静态配置对象，用 `urls` 列出多个 OpenAPI 3 数据源：

```nginx
server {
    listen 80;
    server_name doc.example.com;

    location / {
        root /opt/knife4j-static;
        index doc.html;
        try_files $uri $uri/ =404;
    }

    location = /v3/api-docs/swagger-config {
        alias /opt/knife4j-static/swagger-config.json;
        default_type application/json;
    }

    # 同时代理文档与业务请求；剥离服务前缀后转发
    location /user-service/ {
        proxy_pass http://user-service:8081/;
    }

    location /order-service/ {
        proxy_pass http://order-service:8082/;
    }
}
```

同时创建 `/opt/knife4j-static/swagger-config.json`：

```json
{
  "urls": [
    {
      "name": "用户服务",
      "url": "/user-service/v3/api-docs",
      "contextPath": "/user-service"
    },
    {
      "name": "订单服务",
      "url": "/order-service/v3/api-docs",
      "contextPath": "/order-service"
    }
  ]
}
```

::: warning basePath 问题
上述 `contextPath` 是浏览器访问业务 API 的代理前缀，React 调试器会优先使用当前 origin 加该前缀（UI Host 覆盖仍优先）。示例假设两个下游均部署在根路径；下游另有 context-path 时，须相应调整 `proxy_pass`。若希望由 springdoc 根据反向代理生成 URL，应同时配置 `server.forward-headers-strategy: framework` 和代理的 `X-Forwarded-Prefix`，见[反向代理配置](../reference/configuration#反向代理场景-nginx-prefix-x-forwarded-prefix)。
:::

## 方案二：静态 JSON 文件

适合文档归档、离线预览场景——不代理后端，直接用导出的 OpenAPI JSON。先按方案一获取完整 UI 静态资源，再添加下面的 JSON 和发现配置。

**1. 导出 OpenAPI JSON**

```bash
mkdir -p /opt/knife4j-static/json
curl --fail http://user-service:8081/v3/api-docs -o /opt/knife4j-static/json/user-service.json
curl --fail http://order-service:8082/v3/api-docs -o /opt/knife4j-static/json/order-service.json
```

**2. 部署目录结构**

```
/opt/knife4j-static/
├── doc.html
├── webjars/
│   └── ...
├── json/
│   ├── user-service.json
│   └── order-service.json
└── swagger-config.json
```

**3. swagger-config.json 配置**

```json
{
  "urls": [
    { "name": "用户服务", "url": "/json/user-service.json" },
    { "name": "订单服务", "url": "/json/order-service.json" }
  ]
}
```

**4. Nginx 配置**

```nginx
server {
    listen 80;
    server_name doc.example.com;
    root /opt/knife4j-static;
    index doc.html;

    location / {
        try_files $uri $uri/ =404;
    }

    location = /v3/api-docs/swagger-config {
        alias /opt/knife4j-static/swagger-config.json;
        default_type application/json;
    }
}
```

::: warning 限制
导出的 JSON 不会自动提供业务 API。能否调试取决于 `servers` 或 UI Host 指向的服务是否可达，以及其 CORS、鉴权和浏览器策略；服务不可达时只能浏览文档。仅复制入口 JSON 也不等于包含全部外部引用，离线使用时须保证依赖资源可用。Worker 与动态分块要求见[兼容矩阵](../reference/compatibility#schema-worker-部署要求)。
:::

## 方案三：Gateway 统一入口

如果你使用 Spring Cloud Gateway，推荐使用 `knife4j-gateway-spring-boot-starter`（Boot 3.x）或 `knife4j-gateway-boot4-spring-boot-starter`（Boot 4.x）在 Gateway 层聚合。详见 [Gateway 聚合](./gateway)。

Gateway 模式的好处：
- 不需要提取前端静态文件
- 服务发现自动聚合
- Basic 认证统一保护

## 生产环境安全建议

以下示例用于专门承载文档的独立域名，配置放在该域名的 `server {}` 中，覆盖页面、静态资源、发现配置与 JSON。若该域名也代理业务 API，server 级规则也会影响业务请求，应按实际路径设计完整规则，不能只保护 `/doc.html`。

### 方案 A：Nginx 层拦截

```nginx
# server 级直接关闭整个文档入口
return 403;
```

### 方案 B：Nginx Basic 认证

```nginx
# server 级，供各 location 继承；不要在子 location 中关闭认证
auth_basic "Knife4j Documentation";
auth_basic_user_file /etc/nginx/.htpasswd;
```

### 方案 C：内网访问限制

```nginx
# server 级，子 location 不应另设 allow/deny 覆盖这组规则
allow 10.0.0.0/8;
allow 172.16.0.0/12;
deny all;
```

启用后应分别请求 `/doc.html`、`/v3/api-docs/swagger-config`、`/swagger-config.json`、`/json/user-service.json` 及实际代理的文档 URL，验证未授权请求均被拒绝。后端直连地址仍须单独限制，Nginx 规则不保护绕过 Nginx 的访问。Basic 认证须配合 HTTPS；继承规则见 [Nginx 官方说明](https://nginx.org/en/docs/http/ngx_http_auth_basic_module.html#auth_basic)。

## 相关

- [Gateway 聚合](./gateway)：Spring Cloud Gateway 聚合方案
- [Disk / Nacos / Eureka 聚合](./aggregation)：独立聚合服务方案
- [FAQ / 生产环境禁用](./faq#生产环境怎么禁用-doc-html)：生产环境保护
