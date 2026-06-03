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


package com.github.xiaoymin.knife4j.smoke.aggregationboot3jakarta;

import org.junit.After;
import org.junit.Assert;
import org.junit.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.web.context.WebServerApplicationContext;
import org.springframework.context.ConfigurableApplicationContext;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Smoke coverage for {@code knife4j-aggregation-jakarta-spring-boot-starter} on Spring Boot 3.x.
 *
 * <p>Until issue #417, the standalone (non-gateway) aggregation starter only had targeted
 * unit tests around {@code RouteDispatcher}; the matrix in
 * {@code docs-site/reference/compatibility.md} therefore listed it as ⚠️ manual verification.
 * This module turns that into an automated smoke covering the same surface the React UI
 * relies on:
 *
 * <ul>
 *   <li>application context boots with the aggregation starter on the classpath,</li>
 *   <li>{@code GET /doc.html} returns the React UI shell (webjar packaging not regressed),</li>
 *   <li>{@code GET /v3/api-docs/swagger-config} returns the aggregated group descriptor
 *       (also acts as a regression guard for issue #421 — the {@code NullPointerException}
 *       fix when a route omits {@code servicePath}).</li>
 * </ul>
 *
 * <p>Disk mode is used on purpose: it loads a static OpenAPI document at startup and does
 * not start a heart-beat thread. Cloud mode would try to GET the configured URI on a
 * background thread; on failure the route is removed from the in-memory map, which would
 * make this smoke flaky in environments without network access (notably CI).
 */
public class AggregationBoot3JakartaDocHttpSmokeTest {

    private ConfigurableApplicationContext context;

    @After
    public void closeContext() {
        if (context != null) {
            context.close();
        }
    }

    @Test
    public void shouldBootAggregationStarterAndServeDocHtml() throws IOException {
        context = startAggregationApp();

        int port = ((WebServerApplicationContext) context).getWebServer().getPort();

        // doc.html is served from the React UI webjar shipped by knife4j-openapi3-ui (the
        // jakarta aggregation starter depends on it transitively). If the webjar layout
        // regresses, this 200 + marker check fails loudly.
        HttpResponse docHtml = get(port, "/doc.html");
        Assert.assertEquals(200, docHtml.statusCode);
        Assert.assertTrue(
                "doc.html should reference the React UI webjar shipped with knife4j-openapi3-ui",
                docHtml.body.contains("webjars/knife4j-ui-react/"));
    }

    @Test
    public void shouldServeAggregatedSwaggerConfig() throws IOException {
        context = startAggregationApp();

        int port = ((WebServerApplicationContext) context).getWebServer().getPort();

        // /v3/api-docs/swagger-config is the entry point the React UI calls to discover
        // aggregated groups. Asserting a 200 + group markers here also acts as a
        // regression guard for issue #421 (NPE when a route omits servicePath).
        HttpResponse swaggerConfig = get(port, "/v3/api-docs/swagger-config");
        Assert.assertEquals(200, swaggerConfig.statusCode);
        Assert.assertTrue(
                "swagger-config payload should expose configUrl",
                swaggerConfig.body.contains("\"configUrl\""));
        Assert.assertTrue(
                "swagger-config payload should include /v3/api-docs/swagger-config",
                swaggerConfig.body.contains("/v3/api-docs/swagger-config"));
        Assert.assertTrue(
                "swagger-config payload should expose urls array",
                swaggerConfig.body.contains("\"urls\""));
        Assert.assertTrue(
                "swagger-config payload should advertise the configured aggregation route name",
                swaggerConfig.body.contains("aggregation-demo"));
    }

    private ConfigurableApplicationContext startAggregationApp() {
        return new SpringApplicationBuilder(TestAggregationApplication.class)
                .web(WebApplicationType.SERVLET)
                .properties(
                        "server.port=0",
                        "spring.main.banner-mode=off",
                        "knife4j.enable-aggregation=true",
                        "knife4j.disk.enable=true",
                        "knife4j.disk.routes[0].name=aggregation-demo",
                        "knife4j.disk.routes[0].location=classpath:aggregation/sample-openapi.json",
                        "knife4j.disk.routes[0].swagger-version=3.0",
                        "knife4j.disk.routes[0].order=1",
                        "logging.level.root=ERROR")
                .run();
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

    @SpringBootApplication
    public static class TestAggregationApplication {
    }
}
