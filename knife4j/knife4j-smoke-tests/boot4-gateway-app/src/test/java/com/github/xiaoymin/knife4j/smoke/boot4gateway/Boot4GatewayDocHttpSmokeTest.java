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


package com.github.xiaoymin.knife4j.smoke.boot4gateway;

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

public class Boot4GatewayDocHttpSmokeTest {

    private ConfigurableApplicationContext context;

    @After
    public void closeContext() {
        if (context != null) {
            context.close();
        }
    }

    @Test
    public void shouldServeDocHtmlAndManualSwaggerConfigOnBoot4Gateway() throws IOException {
        context = new SpringApplicationBuilder(TestGatewayApplication.class)
                .web(WebApplicationType.REACTIVE)
                .properties(
                        "server.port=0",
                        "spring.main.banner-mode=off",
                        "knife4j.gateway.enabled=true",
                        "knife4j.gateway.strategy=MANUAL",
                        "knife4j.gateway.routes[0].name=用户中心",
                        "knife4j.gateway.routes[0].service-name=user-service",
                        "knife4j.gateway.routes[0].url=/user-service/v3/api-docs",
                        "knife4j.gateway.routes[0].context-path=/user-service",
                        "knife4j.gateway.routes[0].order=1",
                        "logging.level.root=ERROR")
                .run();

        int port = context.getEnvironment().getRequiredProperty("local.server.port", Integer.class);

        HttpResponse docHtml = get(port, "/doc.html");
        Assert.assertEquals(200, docHtml.statusCode);
        Assert.assertTrue(docHtml.body.contains("webjars/knife4j-ui-react/"));

        HttpResponse swaggerConfig = get(port, "/v3/api-docs/swagger-config");
        Assert.assertEquals(200, swaggerConfig.statusCode);
        Assert.assertTrue(swaggerConfig.body.contains("\"configUrl\""));
        Assert.assertTrue(swaggerConfig.body.contains("/v3/api-docs/swagger-config"));
        Assert.assertTrue(swaggerConfig.body.contains("\"urls\""));
        Assert.assertTrue(swaggerConfig.body.contains("用户中心"));
        Assert.assertTrue(swaggerConfig.body.contains("/user-service/v3/api-docs"));
        Assert.assertTrue(swaggerConfig.body.contains("\"contextPath\":\"/user-service\""));
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
    public static class TestGatewayApplication {
    }
}
