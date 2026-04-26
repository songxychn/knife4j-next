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
import jakarta.validation.constraints.NotBlank;
import org.junit.After;
import org.junit.Assert;
import org.junit.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Regression test for upstream #811: @Validated controller proxied by CGLIB
 * must still be scanned by springdoc and appear in /v3/api-docs.
 *
 * When @Validated is placed on a @RestController, Spring Boot creates a CGLIB
 * subclass proxy. Without proper proxy-unwrapping, the customizer may produce
 * mangled operationIds (e.g. "TestValidatedController$$SpringCGLIB$$0_greet")
 * or fail to resolve annotations on the original class.
 */
public class Boot35ValidatedControllerCglibSmokeTest {

    private ConfigurableApplicationContext context;

    @After
    public void closeContext() {
        if (context != null) {
            context.close();
        }
    }

    @Test
    public void validatedControllerShouldAppearInApiDocs() throws IOException {
        context = new SpringApplicationBuilder(TestApplication.class)
                .web(WebApplicationType.SERVLET)
                .properties(
                        "server.port=0",
                        "knife4j.enable=true",
                        "logging.level.root=ERROR")
                .run();

        int port = context.getEnvironment().getRequiredProperty("local.server.port", Integer.class);

        HttpResponse apiDocs = get(port, "/v3/api-docs");
        Assert.assertEquals(200, apiDocs.statusCode);
        Assert.assertTrue("OpenAPI JSON must contain 'openapi' field", apiDocs.body.contains("\"openapi\""));
        // The @Validated controller endpoint must be present
        Assert.assertTrue("@Validated controller endpoint /greet must appear in api-docs",
                apiDocs.body.contains("/greet"));
        // operationId must NOT contain CGLIB mangled class name
        Assert.assertFalse("operationId must not contain CGLIB proxy suffix",
                apiDocs.body.contains("SpringCGLIB"));
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
     * @Validated triggers CGLIB proxying by Spring AOP.
     * The endpoint must still be discoverable by springdoc.
     */
    @Validated
    @RestController
    public static class TestValidatedController {

        @GetMapping("/greet")
        public String greet(@RequestParam @NotBlank String name) {
            return "Hello, " + name;
        }
    }
}
