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


package com.github.xiaoymin.knife4j.smoke.boot35gatewaymvc;

import org.junit.After;
import org.junit.Assert;
import org.junit.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.cloud.client.ServiceInstance;
import org.springframework.cloud.client.discovery.DiscoveryClient;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Bean;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.List;

public class Boot35GatewayWebMvcDocHttpSmokeTest {

    private ConfigurableApplicationContext context;

    @After
    public void closeContext() {
        if (context != null) {
            context.close();
        }
    }

    @Test
    public void shouldServeManualSwaggerConfigAndBasicAuthOnBoot35GatewayMvc() throws IOException {
        context = application(
                "knife4j.gateway.strategy=MANUAL",
                "knife4j.gateway.basic.enable=true",
                "knife4j.gateway.basic.username=admin",
                "knife4j.gateway.basic.password=change-me",
                "knife4j.gateway.routes[0].name=用户中心",
                "knife4j.gateway.routes[0].service-name=user-service",
                "knife4j.gateway.routes[0].url=/users/v3/api-docs",
                "knife4j.gateway.routes[0].context-path=/users",
                "knife4j.gateway.routes[0].order=1");

        int port = port();
        Assert.assertEquals(401, get(port, "/doc.html", null).statusCode);
        Assert.assertEquals(200, get(port, "/doc.html", "Basic YWRtaW46Y2hhbmdlLW1l").statusCode);

        HttpResponse swaggerConfig = get(port, "/v3/api-docs/swagger-config", "Basic YWRtaW46Y2hhbmdlLW1l");
        Assert.assertEquals(200, swaggerConfig.statusCode);
        Assert.assertTrue(swaggerConfig.body.contains("用户中心"));
        Assert.assertTrue(swaggerConfig.body.contains("/users/v3/api-docs"));
        Assert.assertTrue(swaggerConfig.body.contains("\"contextPath\":\"/users\""));
    }

    @Test
    public void shouldDiscoverConfiguredLoadBalancedMvcRouteOnBoot35() throws IOException {
        context = application(
                "knife4j.gateway.strategy=DISCOVER",
                "spring.cloud.gateway.server.webmvc.routes[0].id=user-service",
                "spring.cloud.gateway.server.webmvc.routes[0].uri=lb://user-service",
                "spring.cloud.gateway.server.webmvc.routes[0].predicates[0].name=Path",
                "spring.cloud.gateway.server.webmvc.routes[0].predicates[0].args._genkey_0=/users/**");

        HttpResponse swaggerConfig = get(port(), "/v3/api-docs/swagger-config", null);
        Assert.assertEquals(200, swaggerConfig.statusCode);
        Assert.assertTrue(swaggerConfig.body.contains("user-service"));
        Assert.assertTrue(swaggerConfig.body.contains("/users/v3/api-docs"));
        Assert.assertTrue(swaggerConfig.body.contains("\"contextPath\":\"/users\""));
    }

    private ConfigurableApplicationContext application(String... properties) {
        String[] defaults = {
                "server.port=0",
                "spring.main.banner-mode=off",
                "knife4j.gateway.enabled=true",
                "logging.level.root=ERROR"
        };
        String[] merged = new String[defaults.length + properties.length];
        System.arraycopy(defaults, 0, merged, 0, defaults.length);
        System.arraycopy(properties, 0, merged, defaults.length, properties.length);
        return new SpringApplicationBuilder(TestGatewayApplication.class)
                .web(WebApplicationType.SERVLET)
                .properties(merged)
                .run();
    }

    private int port() {
        return context.getEnvironment().getRequiredProperty("local.server.port", Integer.class);
    }

    private HttpResponse get(int port, String path, String authorization) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL("http://localhost:" + port + path).openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(5000);
        connection.setReadTimeout(5000);
        if (authorization != null) {
            connection.setRequestProperty("Authorization", authorization);
        }
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

        @Bean
        DiscoveryClient discoveryClient() {
            return new DiscoveryClient() {

                @Override
                public String description() {
                    return "smoke";
                }

                @Override
                public List<ServiceInstance> getInstances(String serviceId) {
                    return Collections.emptyList();
                }

                @Override
                public List<String> getServices() {
                    return Collections.singletonList("user-service");
                }
            };
        }
    }
}
