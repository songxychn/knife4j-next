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


package com.github.xiaoymin.knife4j.smoke.boot3;

import com.github.xiaoymin.knife4j.spring.annotations.EnableKnife4j;
import org.junit.After;
import org.junit.Assert;
import org.junit.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Smoke test for issue #318: when {@code springdoc.use-management-port=true}, the
 * {@code /v3/api-docs/swagger-config} endpoint must be accessible on the main port so the
 * knife4j UI can discover API groups.
 *
 * <p>Upstream: https://github.com/xiaoymin/knife4j/issues/803
 */
public class ManagementPortSwaggerConfigSmokeTest {

    private ConfigurableApplicationContext context;

    @After
    public void closeContext() {
        if (context != null) {
            context.close();
        }
    }

    /**
     * Verifies that {@code /v3/api-docs/swagger-config} is served on the main port when
     * {@code springdoc.use-management-port=true} (issue #318 / upstream #803).
     *
     * <p>Without the fix, springdoc only registers swagger-config on the management port and the
     * main port returns 404. With the fix, knife4j's
     * {@code ManagementPortSwaggerConfigController} serves it on the main port.
     */
    @Test
    public void shouldServeSwaggerConfigOnMainPortWhenUseManagementPortTrue() throws IOException {
        context = new SpringApplicationBuilder(TestApplication.class)
                .web(WebApplicationType.SERVLET)
                .properties(
                        "server.port=0",
                        "management.server.port=0",
                        "knife4j.enable=true",
                        "springdoc.use-management-port=true",
                        "logging.level.root=ERROR")
                .run();

        int port = context.getEnvironment().getRequiredProperty("local.server.port", Integer.class);

        HttpResponse swaggerConfig = get(port, "/v3/api-docs/swagger-config");
        Assert.assertEquals(
                "swagger-config must be accessible on main port when use-management-port=true (issue #318)",
                200, swaggerConfig.statusCode);
        Assert.assertTrue(
                "swagger-config response must contain configUrl field",
                swaggerConfig.body.contains("configUrl"));
        Assert.assertTrue(
                "swagger-config response must contain urls field",
                swaggerConfig.body.contains("urls"));
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
}
