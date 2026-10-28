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


package com.github.xiaoymin.knife4j.smoke.gatewaymvcrefresh;

import org.junit.After;
import org.junit.Assert;
import org.junit.Test;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.cloud.client.ServiceInstance;
import org.springframework.cloud.client.discovery.DiscoveryClient;
import org.springframework.cloud.client.discovery.event.HeartbeatEvent;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Bean;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

/** Real HTTP regression for issue #941, independent of registry-specific event support. */
public class MvcGatewayDiscoveryRefreshHttpSmokeTest {

    private ConfigurableApplicationContext context;

    @After
    public void closeContext() {
        if (context != null) {
            context.close();
        }
    }

    @Test
    public void servicePresentBeforeGatewayStartupIsVisible() throws Exception {
        start(true);
        Assert.assertTrue(snapshot("present-at-startup").contains("user-service"));
    }

    @Test
    public void lateServiceShouldBecomeVisibleAfterCacheExpiryWithoutHeartbeat() throws Exception {
        start(false);
        Assert.assertFalse(snapshot("before-registration").contains("user-service"));
        discovery().services.set(Collections.singletonList("user-service"));
        Assert.assertEquals(Collections.singletonList("user-service"), discovery().getServices());
        System.out.println("REPRO discovery-after-registration=" + discovery().getServices());
        String afterRegistration = snapshot("after-registration-request-1");
        snapshot("after-registration-request-2");
        Assert.assertFalse(afterRegistration.contains("user-service"));
        Thread.sleep(5100);
        String afterExpiry = snapshot("after-cache-expiry-without-heartbeat");
        // Control: the same service is visible after restarting the gateway.
        context.close();
        start(true);
        Assert.assertTrue(snapshot("after-gateway-restart").contains("user-service"));
        Assert.assertTrue("Late service is missing from swagger-config although DiscoveryClient lists it",
                afterExpiry.contains("user-service"));
    }

    @Test
    public void heartbeatRefreshesLateRegistrationAndRemoval() throws Exception {
        start(false);
        Assert.assertFalse(snapshot("heartbeat-control-initial").contains("user-service"));
        discovery().services.set(Collections.singletonList("user-service"));
        context.publishEvent(new HeartbeatEvent(this, 1));
        Assert.assertTrue(snapshot("after-registration-heartbeat").contains("user-service"));
        discovery().services.set(Collections.emptyList());
        Assert.assertTrue(snapshot("after-removal-without-heartbeat").contains("user-service"));
        context.publishEvent(new HeartbeatEvent(this, 2));
        Assert.assertFalse(snapshot("after-removal-heartbeat").contains("user-service"));
    }

    private void start(boolean initiallyRegistered) {
        context = new SpringApplicationBuilder(ReproductionApplication.class)
                .web(WebApplicationType.SERVLET)
                .properties("server.address=127.0.0.1", "server.port=0", "spring.main.banner-mode=off",
                        "logging.level.root=ERROR", "knife4j.gateway.enabled=true", "knife4j.gateway.strategy=DISCOVER",
                        "repro.initially-registered=" + initiallyRegistered,
                        "spring.cloud.gateway.server.webmvc.routes[0].id=user-service",
                        "spring.cloud.gateway.server.webmvc.routes[0].uri=lb://user-service",
                        "spring.cloud.gateway.server.webmvc.routes[0].predicates[0].name=Path",
                        "spring.cloud.gateway.server.webmvc.routes[0].predicates[0].args._genkey_0=/users/**")
                .run();
    }

    private MutableDiscoveryClient discovery() {
        return context.getBean(MutableDiscoveryClient.class);
    }

    private String snapshot(String stage) throws Exception {
        int port = context.getEnvironment().getRequiredProperty("local.server.port", Integer.class);
        HttpURLConnection connection = (HttpURLConnection) new URL(
                "http://127.0.0.1:" + port + "/v3/api-docs/swagger-config").openConnection();
        connection.setConnectTimeout(5000);
        connection.setReadTimeout(5000);
        try {
            Assert.assertEquals(200, connection.getResponseCode());
            try (InputStream input = connection.getInputStream()) {
                String body = new String(input.readAllBytes(), StandardCharsets.UTF_8);
                System.out.println("REPRO " + stage + "=" + body);
                return body;
            }
        } finally {
            connection.disconnect();
        }
    }

    @SpringBootConfiguration
    @EnableAutoConfiguration
    public static class ReproductionApplication {

        @Bean
        MutableDiscoveryClient discoveryClient(org.springframework.core.env.Environment environment) {
            return new MutableDiscoveryClient(environment.getProperty("repro.initially-registered", Boolean.class, false));
        }
    }

    public static class MutableDiscoveryClient implements DiscoveryClient {

        final AtomicReference<List<String>> services = new AtomicReference<>(Collections.emptyList());

        MutableDiscoveryClient(boolean initiallyRegistered) {
            if (initiallyRegistered) {
                services.set(Collections.singletonList("user-service"));
            }
        }

        @Override
        public String description() {
            return "issue-941-mutable-discovery";
        }

        @Override
        public List<ServiceInstance> getInstances(String serviceId) {
            return Collections.emptyList();
        }

        @Override
        public List<String> getServices() {
            return services.get();
        }
    }
}
