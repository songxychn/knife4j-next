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


package com.github.xiaoymin.knife4j.smoke.boot3aggregation;

import com.github.xiaoymin.knife4j.aggre.polaris.PolarisRoute;
import com.github.xiaoymin.knife4j.aggre.polaris.PolarisService;
import com.github.xiaoymin.knife4j.aggre.repository.PolarisRepository;
import com.github.xiaoymin.knife4j.aggre.spring.configuration.Knife4jAggregationAutoConfiguration;
import com.github.xiaoymin.knife4j.aggre.spring.support.PolarisSetting;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.After;
import org.junit.Assert;
import org.junit.Before;
import org.junit.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.core.env.MapPropertySource;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

public class PolarisDiscoverySmokeTest {

    private HttpServer server;
    private String serviceUrl;
    private final AtomicInteger logins = new AtomicInteger();
    private final AtomicInteger queries = new AtomicInteger();
    private final AtomicInteger cookies = new AtomicInteger();
    private final AtomicInteger invalidRequests = new AtomicInteger();
    private volatile boolean requireAuthentication;
    private volatile boolean rejectFirstQuery;

    @Before
    public void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/core/v1/user/login", exchange -> {
            logins.incrementAndGet();
            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            if (!"POST".equals(exchange.getRequestMethod()) || !body.contains("test-user") || !body.contains("test-password")) {
                invalidRequests.incrementAndGet();
            }
            exchange.getResponseHeaders().add("Set-Cookie", "polaris-token=test-token");
            respond(exchange, "{}");
        });
        server.createContext("/naming/v1/instances", exchange -> {
            int count = queries.incrementAndGet();
            String cookie = exchange.getRequestHeaders().getFirst("Cookie");
            if (cookie != null) {
                cookies.incrementAndGet();
            }
            if (!"GET".equals(exchange.getRequestMethod())
                    || !"namespace=default&healthy=true&service=user-service".equals(exchange.getRequestURI().getRawQuery())
                    || (requireAuthentication && !"polaris-token=test-token".equals(cookie))) {
                invalidRequests.incrementAndGet();
            }
            // A second request succeeds, so the pre-fix recursive retry fails the count assertion without hanging.
            if (rejectFirstQuery && count == 1) {
                respond(exchange, "{\"code\":407}");
            } else {
                respond(exchange, "{\"code\":200000,\"instances\":[{\"host\":\"127.0.0.1\",\"port\":18080}]}");
            }
        });
        server.start();
        serviceUrl = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @After
    public void stopServer() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    public void shouldDiscoverWithoutAuthenticationOrCookie() {
        Map<String, Object> properties = properties();
        assertDiscovers(properties);
        properties.put("knife4j.polaris.service-auth.enable", "false");
        assertDiscovers(properties);
        Assert.assertEquals(0, logins.get());
        Assert.assertEquals(0, cookies.get());
        Assert.assertEquals(0, invalidRequests.get());
    }

    @Test
    public void shouldKeepLoginAndAuthenticatedDiscoveryWorking() {
        requireAuthentication = true;
        Map<String, Object> properties = properties();
        properties.put("knife4j.polaris.service-auth.enable", "true");
        properties.put("knife4j.polaris.service-auth.username", "test-user");
        properties.put("knife4j.polaris.service-auth.password", "test-password");
        assertDiscovers(properties);
        Assert.assertEquals(1, logins.get());
        Assert.assertTrue(cookies.get() > 0);
        Assert.assertEquals(0, invalidRequests.get());
    }

    @Test
    public void shouldNotLoginOrRetryWhenAnonymousDiscoveryIsRejected() throws Exception {
        rejectFirstQuery = true;
        PolarisSetting setting = new PolarisSetting();
        setting.setServiceUrl(serviceUrl);
        PolarisRoute route = new PolarisRoute();
        route.setNamespace("default");
        route.setService("user-service");
        Assert.assertFalse(new PolarisService(setting, serviceUrl, null, route).call().isPresent());
        Assert.assertEquals(1, queries.get());
        Assert.assertEquals(0, logins.get());
        Assert.assertEquals(0, cookies.get());
        Assert.assertEquals(0, invalidRequests.get());
    }

    private void assertDiscovers(Map<String, Object> properties) {
        try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext()) {
            context.getEnvironment().getPropertySources().addFirst(new MapPropertySource("polaris-test", properties));
            context.register(Knife4jAggregationAutoConfiguration.class);
            context.refresh();
            PolarisRepository repository = context.getBean(PolarisRepository.class);
            Assert.assertEquals(1, repository.getRoutes().size());
            Assert.assertEquals("用户服务", repository.getRoutes().get(0).getName());
            Assert.assertEquals("http://127.0.0.1:18080", repository.getRoutes().get(0).getUri());
            Assert.assertEquals(serviceUrl, context.getBean(PolarisSetting.class).getServiceUrl());
        }
    }

    private Map<String, Object> properties() {
        Map<String, Object> properties = new LinkedHashMap<>();
        properties.put("knife4j.enable-aggregation", "true");
        properties.put("knife4j.polaris.enable", "true");
        properties.put("knife4j.polaris.service-url", serviceUrl);
        properties.put("knife4j.polaris.routes[0].name", "用户服务");
        properties.put("knife4j.polaris.routes[0].service", "user-service");
        properties.put("knife4j.polaris.routes[0].namespace", "default");
        properties.put("knife4j.polaris.routes[0].location", "/v3/api-docs");
        properties.put("knife4j.polaris.routes[0].swagger-version", "3.0");
        return properties;
    }

    private void respond(HttpExchange exchange, String body) throws IOException {
        try {
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes);
        } finally {
            exchange.close();
        }
    }
}
