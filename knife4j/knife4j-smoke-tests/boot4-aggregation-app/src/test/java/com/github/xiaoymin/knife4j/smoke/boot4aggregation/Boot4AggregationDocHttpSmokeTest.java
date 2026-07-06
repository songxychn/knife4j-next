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


package com.github.xiaoymin.knife4j.smoke.boot4aggregation;

import org.junit.After;
import org.junit.Assert;
import org.junit.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class Boot4AggregationDocHttpSmokeTest {

    private static final Pattern SWAGGER_INSTANCE_URL = Pattern.compile("\"url\":\"([^\"]*/swagger-instance\\?group=[^\"]+)\"");

    private ConfigurableApplicationContext context;

    @After
    public void closeContext() {
        if (context != null) {
            context.close();
        }
    }

    @Test
    public void shouldServeDocHtmlAndDiskSwaggerConfigOnBoot4Aggregation() throws IOException {
        context = new SpringApplicationBuilder(TestAggregationApplication.class)
                .web(WebApplicationType.SERVLET)
                .properties(
                        "server.port=0",
                        "spring.main.banner-mode=off",
                        "knife4j.enable-aggregation=true",
                        "knife4j.disk.enable=true",
                        "knife4j.disk.routes[0].name=聚合用户服务",
                        "knife4j.disk.routes[0].location=classpath:swagger/user-service-openapi.json",
                        "knife4j.disk.routes[0].swagger-version=3.0",
                        "knife4j.disk.routes[0].service-path=/user-service",
                        "knife4j.disk.routes[0].order=1",
                        "logging.level.root=ERROR")
                .run();

        int port = context.getEnvironment().getRequiredProperty("local.server.port", Integer.class);

        HttpResponse docHtml = get(port, "/doc.html");
        Assert.assertEquals(200, docHtml.statusCode);
        Assert.assertTrue(docHtml.body.contains("webjars/knife4j-ui-react/"));

        HttpResponse swaggerConfig = get(port, "/v3/api-docs/swagger-config");
        Assert.assertEquals(200, swaggerConfig.statusCode);
        String swaggerConfigBody = swaggerConfig.body.replace("\\u003d", "=");
        Assert.assertTrue(swaggerConfigBody.contains("\"configUrl\""));
        Assert.assertTrue(swaggerConfigBody.contains("/v3/api-docs/swagger-config"));
        Assert.assertTrue(swaggerConfigBody.contains("\"urls\""));
        Assert.assertTrue(swaggerConfigBody.contains("聚合用户服务"));
        Assert.assertTrue(swaggerConfigBody.contains("/user-service/swagger-instance?group="));
        Assert.assertTrue(swaggerConfigBody.contains("\"contextPath\":\"/user-service\""));

        String swaggerInstanceUrl = extractSwaggerInstanceUrl(swaggerConfigBody);
        HttpResponse swaggerInstance = get(port, swaggerInstanceUrl);
        Assert.assertEquals(200, swaggerInstance.statusCode);
        Assert.assertTrue(swaggerInstance.body.contains("\"openapi\": \"3.0.3\""));
        Assert.assertTrue(swaggerInstance.body.contains("Aggregated User Service"));
        Assert.assertTrue(swaggerInstance.body.contains("/users"));
    }

    private String extractSwaggerInstanceUrl(String swaggerConfigBody) {
        Matcher matcher = SWAGGER_INSTANCE_URL.matcher(swaggerConfigBody);
        Assert.assertTrue("swagger-config should expose a disk swagger-instance URL:\n" + swaggerConfigBody,
                matcher.find());
        return matcher.group(1);
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
