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

package com.github.xiaoymin.knife4j.smoke.boot3313;

import com.github.xiaoymin.knife4j.spring.annotations.EnableKnife4j;
import org.junit.After;
import org.junit.Assert;
import org.junit.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * Regression test for issue #303 / upstream knife4j#961:
 * Spring Boot 3.3.13 triggers a ResolvableType.equalsType NPE when springdoc
 * processes controllers that return generic types (e.g. ResponseEntity<List<T>>).
 *
 * <p>Two scenarios are covered:
 * <ol>
 *   <li>{@link #shouldGenerateApiDocsWithGenericReturnTypes()} — exercises
 *       {@code Knife4jJakartaOperationCustomizer.customize()} with generic return types,
 *       which is the primary NPE trigger path.</li>
 *   <li>{@link #shouldGenerateApiDocsWithGroupConfigPackageScan()} — configures
 *       {@code springdoc.group-configs[0].packages-to-scan} so that
 *       {@code Knife4jOpenApiCustomizer.scanPackageByAnnotation()} is also exercised,
 *       covering the secondary NPE path (issue #303 / upstream #961).</li>
 * </ol>
 */
public class Boot3313JakartaResolvableTypeNpeTest {

    private ConfigurableApplicationContext context;

    @After
    public void closeContext() {
        if (context != null) {
            context.close();
        }
    }

    /**
     * Verifies that api-docs generation does not throw ResolvableType.equalsType NPE
     * when controllers expose endpoints with generic return types.
     * Exercises: Knife4jJakartaOperationCustomizer.customize() try-catch guard.
     * Regression for: https://github.com/songxychn/knife4j-next/issues/303
     */
    @Test
    public void shouldGenerateApiDocsWithGenericReturnTypes() throws IOException {
        context = new SpringApplicationBuilder(TestApplication.class)
                .web(WebApplicationType.SERVLET)
                .properties(
                        "server.port=0",
                        "knife4j.enable=true",
                        "logging.level.root=ERROR")
                .run();

        int port = context.getEnvironment().getRequiredProperty("local.server.port", Integer.class);

        HttpResponse apiDocs = get(port, "/v3/api-docs");
        Assert.assertEquals(
                "Expected HTTP 200 from /v3/api-docs but got " + apiDocs.statusCode
                        + ". Body: " + apiDocs.body,
                200, apiDocs.statusCode);
        Assert.assertTrue(
                "Expected openapi field in api-docs response",
                apiDocs.body.contains("\"openapi\""));
        Assert.assertTrue(
                "Expected /items endpoint in api-docs",
                apiDocs.body.contains("/items"));
    }

    /**
     * Verifies that api-docs generation does not throw ResolvableType.equalsType NPE
     * when springdoc.group-configs is configured with packages-to-scan.
     * Exercises: Knife4jOpenApiCustomizer.scanPackageByAnnotation() NPE guard path.
     * Regression for: https://github.com/songxychn/knife4j-next/issues/303
     */
    @Test
    public void shouldGenerateApiDocsWithGroupConfigPackageScan() throws IOException {
        context = new SpringApplicationBuilder(TestApplication.class)
                .web(WebApplicationType.SERVLET)
                .properties(
                        "server.port=0",
                        "knife4j.enable=true",
                        // Configure group-configs with packages-to-scan so that
                        // Knife4jOpenApiCustomizer.addOrderExtension() proceeds past the
                        // early-return guard and calls scanPackageByAnnotation().
                        "springdoc.group-configs[0].group=default",
                        "springdoc.group-configs[0].packages-to-scan=com.github.xiaoymin.knife4j.smoke.boot3313",
                        "logging.level.root=ERROR")
                .run();

        int port = context.getEnvironment().getRequiredProperty("local.server.port", Integer.class);

        HttpResponse apiDocs = get(port, "/v3/api-docs/default");
        Assert.assertEquals(
                "Expected HTTP 200 from /v3/api-docs/default but got " + apiDocs.statusCode
                        + ". Body: " + apiDocs.body,
                200, apiDocs.statusCode);
        Assert.assertTrue(
                "Expected openapi field in api-docs response",
                apiDocs.body.contains("\"openapi\""));
    }

    @Test
    public void shouldServeDocHtml() throws IOException {
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

    /**
     * Controller with a plain endpoint — baseline.
     */
    @RestController
    public static class SimpleController {

        @GetMapping("/hello")
        public String hello() {
            return "hello";
        }
    }

    /**
     * Controller with generic return types.
     * In Spring Boot 3.3.13 (Spring Framework 6.1.x), springdoc's type resolution
     * calls ResolvableType.equalsType on the return type, which can NPE when the
     * resolved generic argument is null/NONE for certain type hierarchies.
     */
    @RestController
    public static class GenericController {

        @GetMapping("/items")
        public ResponseEntity<List<String>> listItems() {
            return ResponseEntity.ok(List.of("a", "b"));
        }

        @GetMapping("/wrapped")
        public ApiResult<String> wrappedResult() {
            return new ApiResult<>("ok");
        }
    }

    /**
     * Generic wrapper type — exercises ResolvableType resolution of parameterized
     * return types, which is the trigger for the equalsType NPE in SB 3.3.13.
     */
    public static class ApiResult<T> {
        private final T data;

        public ApiResult(T data) {
            this.data = data;
        }

        public T getData() {
            return data;
        }
    }
}
