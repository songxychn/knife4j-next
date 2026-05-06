---
title: 前端独立部署
---

# 前端独立部署

Knife4j 的 `doc.html` 默认嵌入在 Spring Boot 应用中。在某些场景下，你需要将前端 UI 静态资源独立部署：

- 前后端分离架构，API 服务不暴露静态资源
- 多个后端服务需要统一的文档入口
- 生产环境需要严格管控文档访问

本文介绍三种部署方案。

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
# 解压 META-INF/resources/ 目录
mkdir -p /opt/knife4j-static
unzip -j ~/.m2/repository/com/baizhukui/knife4j-openapi3-ui/5.0.0/knife4j-openapi3-ui-5.0.0.jar \
  "META-INF/resources/*" -d /opt/knife4j-static/
```

**2. 配置 Nginx**

```nginx
server {
    listen 80;
    server_name doc.example.com;

    # 静态文件
    location / {
        root /opt/knife4j-static;
        index doc.html;
        try_files $uri $uri/ /doc.html;
    }

    # 代理 OpenAPI 接口
    location /v3/api-docs {
        proxy_pass http://backend:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # 代理旧版 Swagger2 接口（如需要）
    location /v2/api-docs {
        proxy_pass http://backend:8080;
        proxy_set_header Host $host;
    }

    # 代理 springdoc 分组接口
    location /swagger-resources {
        proxy_pass http://backend:8080;
    }
}
```

::: tip 后端配置
后端需启用 CORS 或在 Nginx 层统一处理跨域。如果用 `knife4j.cors: true`，后端自动启用 CORS。
:::

### 多服务聚合

通过 `group.json` 配置多个后端服务的 OpenAPI 数据源：

```nginx
server {
    listen 80;
    server_name doc.example.com;

    location / {
        root /opt/knife4j-static;
        index doc.html;
    }

    # 用户服务
    location /user-service/v3/api-docs {
        proxy_pass http://user-service:8081/v3/api-docs;
    }

    # 订单服务
    location /order-service/v3/api-docs {
        proxy_pass http://order-service:8082/v3/api-docs;
    }
}
```

同时创建分组配置文件 `/opt/knife4j-static/group.json`：

```json
[
  {
    "name": "用户服务",
    "url": "/user-service/v3/api-docs?group=default",
    "swaggerVersion": "3.0",
    "location": "/user-service/v3/api-docs?group=default"
  },
  {
    "name": "订单服务",
    "url": "/order-service/v3/api-docs?group=default",
    "swaggerVersion": "3.0",
    "location": "/order-service/v3/api-docs?group=default"
  }
]
```

::: warning basePath 问题
OpenAPI3 规范没有 Swagger2 的 `basePath` 字段。如果后端有 `server.servlet.context-path`，前端调试时请求路径可能不对。解决方法：
1. 在后端 `application.yml` 中配置 `server.forward-headers-strategy: framework`
2. 或在 Nginx 透传 `X-Forwarded-Prefix` 头
:::

## 方案二：静态 JSON 文件

适合文档归档、离线预览场景——不代理后端，直接用导出的 OpenAPI JSON。

**1. 导出 OpenAPI JSON**

```bash
curl http://localhost:8080/v3/api-docs -o swagger.json
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
└── group.json
```

**3. group.json 配置**

```json
[
  {
    "name": "用户服务",
    "url": "/json/user-service.json",
    "swaggerVersion": "3.0",
    "location": "/json/user-service.json"
  },
  {
    "name": "订单服务",
    "url": "/json/order-service.json",
    "swaggerVersion": "3.0",
    "location": "/json/order-service.json"
  }
]
```

**4. Nginx 配置**

```nginx
server {
    listen 80;
    server_name doc.example.com;
    root /opt/knife4j-static;
    index doc.html;

    location / {
        try_files $uri $uri/ /doc.html;
    }
}
```

::: warning 限制
静态 JSON 模式只能**浏览文档**，无法**在线调试**（请求无法到达后端）。如需调试，使用方案一。
:::

## 方案三：Gateway 统一入口

如果你使用 Spring Cloud Gateway，推荐使用 `knife4j-gateway-spring-boot-starter` 在 Gateway 层聚合。详见 [Gateway 聚合](./gateway)。

Gateway 模式的好处：
- 不需要提取前端静态文件
- 服务发现自动聚合
- Basic 认证统一保护

## 生产环境安全建议

无论使用哪种方案，生产环境都应控制文档访问：

### 方案 A：Nginx 层拦截

```nginx
# 生产环境直接返回 403
location /doc.html {
    return 403;
}
location /v3/api-docs {
    return 403;
}
```

### 方案 B：Nginx Basic 认证

```nginx
location /doc.html {
    auth_basic "Knife4j Documentation";
    auth_basic_user_file /etc/nginx/.htpasswd;
    root /opt/knife4j-static;
}
```

### 方案 C：内网访问限制

```nginx
location /doc.html {
    allow 10.0.0.0/8;
    allow 172.16.0.0/12;
    deny all;
    root /opt/knife4j-static;
}
```

## 相关

- [Gateway 聚合](./gateway)：Spring Cloud Gateway 聚合方案
- [Disk / Nacos / Eureka 聚合](./aggregation)：独立聚合服务方案
- [FAQ / 生产环境禁用](./faq#doc-html-404)：生产环境保护

