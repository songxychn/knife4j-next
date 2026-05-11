/*
 * Copyright © 2017-2023 Knife4j(xiaoymin@foxmail.com)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


package com.github.xiaoymin.knife4j.smoke.boot4;

import com.github.xiaoymin.knife4j.spring.annotations.EnableKnife4j;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.junit.After;
import org.junit.Assert;
import org.junit.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;

public class Boot4JakartaDocHttpSmokeTest {

    private ConfigurableApplicationContext context;

    @After
    public void closeContext() {
        if (context != null) {
            context.close();
        }
    }

    @Test
    public void shouldServeDocHtmlOpenApiJsonAndSwaggerConfig() throws IOException {
        context = new SpringApplicationBuilder(TestApplication.class)
                .web(WebApplicationType.SERVLET)
                .properties(
                        "server.port=0",
                        "knife4j.enable=true",
                        "logging.level.root=ERROR")
                .run();

        int port = context.getEnvironment().getRequiredProperty("local.server.port", Integer.class);

        HttpResponse docHtml = get(port, "/doc.html");
        Assert.assertEquals(200, docHtml.statusCode);
        Assert.assertTrue(docHtml.body.contains("webjars/knife4j-ui-react/"));

        HttpResponse apiDocs = get(port, "/v3/api-docs");
        Assert.assertEquals(200, apiDocs.statusCode);
        Assert.assertTrue(apiDocs.body.contains("\"openapi\""));
        Assert.assertTrue(apiDocs.body.contains("/hello"));
        Assert.assertTrue(apiDocs.body.contains("/api/user/list"));
        Assert.assertTrue(apiDocs.body.contains("/api/user/page"));
        Assert.assertTrue(apiDocs.body.contains("/api/user/{id}"));
        Assert.assertTrue(apiDocs.body.contains("用户接口"));
        Assert.assertFalse(apiDocs.body.contains("/knife4j/config"));

        HttpResponse swaggerConfig = get(port, "/v3/api-docs/swagger-config");
        Assert.assertEquals(200, swaggerConfig.statusCode);
        Assert.assertTrue(swaggerConfig.body.contains("/v3/api-docs"));

        HttpResponse knife4jConfig = get(port, "/knife4j/config");
        Assert.assertEquals(200, knife4jConfig.statusCode);
        Assert.assertTrue(knife4jConfig.body.contains("\"schemaVersion\""));
        Assert.assertTrue(knife4jConfig.body.contains("\"openapi\""));
        Assert.assertTrue(knife4jConfig.body.contains("\"apiDocsUrl\""));
        Assert.assertTrue(knife4jConfig.body.contains("v3/api-docs"));
        Assert.assertTrue(knife4jConfig.body.contains("\"swaggerConfigUrl\""));
        Assert.assertTrue(knife4jConfig.body.contains("v3/api-docs/swagger-config"));

        HttpResponse legacyConfig = get(port, "/knife4j/swagger-config");
        Assert.assertEquals(404, legacyConfig.statusCode);
    }

    @Test
    public void shouldServeCustomApiDocsPathThroughKnife4jRuntimeConfig() throws IOException {
        context = new SpringApplicationBuilder(TestApplication.class)
                .web(WebApplicationType.SERVLET)
                .properties(
                        "server.port=0",
                        "knife4j.enable=true",
                        "springdoc.api-docs.path=/api/openapi",
                        "logging.level.root=ERROR")
                .run();

        int port = context.getEnvironment().getRequiredProperty("local.server.port", Integer.class);

        HttpResponse apiDocs = get(port, "/api/openapi");
        Assert.assertEquals(200, apiDocs.statusCode);
        Assert.assertTrue(apiDocs.body.contains("\"openapi\""));
        Assert.assertFalse(apiDocs.body.contains("/knife4j/config"));

        HttpResponse defaultConfig = get(port, "/v3/api-docs/swagger-config");
        Assert.assertEquals(404, defaultConfig.statusCode);

        HttpResponse knife4jConfig = get(port, "/knife4j/config");
        Assert.assertEquals(200, knife4jConfig.statusCode);
        Assert.assertTrue(knife4jConfig.body.contains("\"schemaVersion\""));
        Assert.assertTrue(knife4jConfig.body.contains("\"openapi\""));
        Assert.assertTrue(knife4jConfig.body.contains("\"apiDocsUrl\""));
        Assert.assertTrue(knife4jConfig.body.contains("api/openapi"));
        Assert.assertTrue(knife4jConfig.body.contains("\"swaggerConfigUrl\""));
        Assert.assertTrue(knife4jConfig.body.contains("api/openapi/swagger-config"));

        HttpResponse customConfig = get(port, "/api/openapi/swagger-config");
        Assert.assertEquals(200, customConfig.statusCode);
        Assert.assertTrue(customConfig.body.contains("/api/openapi"));
    }

    private HttpResponse get(int port, String path) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL("http://localhost:" + port + path).openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(5000);
        connection.setReadTimeout(5000);
        int statusCode = connection.getResponseCode();
        InputStream input = statusCode >= 400 ? connection.getErrorStream() : connection.getInputStream();
        return new HttpResponse(statusCode, read(input));
    }

    private String read(InputStream input) throws IOException {
        if (input == null) {
            return "";
        }
        try (InputStream body = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[1024];
            int length;
            while ((length = body.read(buffer)) != -1) {
                output.write(buffer, 0, length);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    private static class HttpResponse {

        private final int statusCode;
        private final String body;

        private HttpResponse(int statusCode, String body) {
            this.statusCode = statusCode;
            this.body = body;
        }
    }

    @EnableKnife4j
    @SpringBootApplication
    public static class TestApplication {
    }

    @RestController
    public static class TestController {

        @GetMapping("/hello")
        public String hello() {
            return "hello";
        }
    }

    @Tag(name = "用户接口", description = "Boot4 用户相关示例接口")
    @RestController
    @RequestMapping("/api/user")
    public static class DemoUserController {

        @Operation(summary = "获取用户列表")
        @GetMapping("/list")
        public List<UserVO> list() {
            return demoUsers();
        }

        @Operation(summary = "分页查询用户")
        @GetMapping("/page")
        public PageResult page(
                               @Parameter(description = "页码（从 1 开始）") @RequestParam(defaultValue = "1") int pageNum,
                               @Parameter(description = "每页条数") @RequestParam(defaultValue = "10") int pageSize,
                               @Parameter(description = "关键词（模糊搜索用户名或邮箱）") @RequestParam(required = false) String keyword) {
            List<UserVO> users = demoUsers();
            return new PageResult(pageNum, pageSize, users.size(), users);
        }

        @Operation(summary = "根据 ID 获取用户")
        @GetMapping("/{id}")
        public UserVO getById(
                              @Parameter(description = "用户 ID") @PathVariable Long id) {
            return new UserVO(id, "张三", "zhangsan@example.com");
        }

        @Operation(summary = "创建用户")
        @PostMapping
        public UserVO create(@RequestBody UserCreateRequest request) {
            return new UserVO(3L, request.name, request.email);
        }

        @Operation(summary = "更新用户")
        @PutMapping("/{id}")
        public UserVO update(
                             @Parameter(description = "用户 ID") @PathVariable Long id,
                             @RequestBody UserUpdateRequest request) {
            return new UserVO(id, request.name, request.email);
        }

        @Operation(summary = "删除用户")
        @DeleteMapping("/{id}")
        public UserVO delete(
                             @Parameter(description = "用户 ID") @PathVariable Long id) {
            return new UserVO(id, "张三", "zhangsan@example.com");
        }

        private List<UserVO> demoUsers() {
            return List.of(
                    new UserVO(1L, "张三", "zhangsan@example.com"),
                    new UserVO(2L, "李四", "lisi@example.com"));
        }
    }

    @Schema(description = "用户视图对象")
    public static class UserVO {

        @Schema(description = "用户 ID", example = "1")
        public Long id;

        @Schema(description = "用户名", example = "张三")
        public String name;

        @Schema(description = "邮箱地址", example = "zhangsan@example.com")
        public String email;

        public UserVO() {
        }

        public UserVO(Long id, String name, String email) {
            this.id = id;
            this.name = name;
            this.email = email;
        }
    }

    @Schema(description = "创建用户请求")
    public static class UserCreateRequest {

        @Schema(description = "用户名", example = "张三", requiredMode = Schema.RequiredMode.REQUIRED)
        public String name;

        @Schema(description = "邮箱地址", example = "zhangsan@example.com", requiredMode = Schema.RequiredMode.REQUIRED)
        public String email;
    }

    @Schema(description = "更新用户请求")
    public static class UserUpdateRequest {

        @Schema(description = "用户名", example = "李四")
        public String name;

        @Schema(description = "邮箱地址", example = "lisi@example.com")
        public String email;
    }

    @Schema(description = "分页结果")
    public static class PageResult {

        @Schema(description = "当前页码", example = "1")
        public int pageNum;

        @Schema(description = "每页条数", example = "10")
        public int pageSize;

        @Schema(description = "总记录数", example = "2")
        public long total;

        @Schema(description = "数据列表")
        public List<UserVO> list;

        public PageResult() {
        }

        public PageResult(int pageNum, int pageSize, long total, List<UserVO> list) {
            this.pageNum = pageNum;
            this.pageSize = pageSize;
            this.total = total;
            this.list = list;
        }
    }
}
