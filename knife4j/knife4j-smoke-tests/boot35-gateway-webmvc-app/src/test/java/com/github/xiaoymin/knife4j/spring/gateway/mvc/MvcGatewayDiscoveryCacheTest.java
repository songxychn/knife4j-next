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


package com.github.xiaoymin.knife4j.spring.gateway.mvc;

import org.junit.Assert;
import org.junit.Test;
import org.springframework.cloud.client.ServiceInstance;
import org.springframework.cloud.client.discovery.DiscoveryClient;
import org.springframework.cloud.gateway.server.mvc.config.GatewayMvcProperties;
import org.springframework.cloud.gateway.server.mvc.config.PredicateProperties;
import org.springframework.cloud.gateway.server.mvc.config.RouteProperties;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.web.server.ResponseStatusException;

import java.net.URI;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Supplier;

public class MvcGatewayDiscoveryCacheTest {

    private final AtomicLong time = new AtomicLong();
    private final TestDiscoveryClient discovery = new TestDiscoveryClient();
    private final MvcGatewayDiscoveryService service = service();

    @Test
    public void discoversLateRegistrationAndRemovalOnlyWhenCacheExpires() {
        Assert.assertTrue(service.resources("").isEmpty());
        discovery.result = () -> List.of("user-service", "unconfigured-service");
        time.set(TimeUnit.SECONDS.toNanos(5) - 1);
        Assert.assertTrue(service.resources("").isEmpty());
        Assert.assertEquals(1, discovery.calls.get());
        time.incrementAndGet();
        List<MvcOpenApiResource> resources = service.resources("/gateway");
        Assert.assertEquals(1, resources.size());
        Assert.assertEquals("user-service", resources.get(0).getName());
        Assert.assertEquals("/gateway/users/v3/api-docs", resources.get(0).getUrl());
        Assert.assertEquals("/gateway/users", resources.get(0).getContextPath());
        Assert.assertEquals("/users/v3/api-docs", service.resources("").get(0).getUrl());
        discovery.result = Collections::emptyList;
        time.addAndGet(TimeUnit.SECONDS.toNanos(5));
        Assert.assertTrue(service.resources("").isEmpty());
        Assert.assertEquals(3, discovery.calls.get());
    }

    @Test
    public void ttlStartsWhenSlowQueryCompletes() {
        discovery.result = () -> {
            time.addAndGet(TimeUnit.SECONDS.toNanos(20));
            return List.of("user-service");
        };
        service.resources("");
        discovery.result = Collections::emptyList;
        time.set(TimeUnit.SECONDS.toNanos(25) - 1);
        Assert.assertFalse(service.resources("").isEmpty());
        Assert.assertEquals(1, discovery.calls.get());
        time.incrementAndGet();
        Assert.assertTrue(service.resources("").isEmpty());
    }

    @Test
    public void eventRefreshBypassesTtl() {
        service.refresh();
        discovery.result = () -> List.of("user-service");
        service.refresh();
        Assert.assertEquals(1, service.resources("").size());
        discovery.result = Collections::emptyList;
        service.refresh();
        Assert.assertTrue(service.resources("").isEmpty());
        Assert.assertEquals(3, discovery.calls.get());
    }

    @Test
    public void failedRefreshKeepsLastSnapshotAndThrottlesRetries() {
        discovery.result = () -> List.of("user-service");
        service.refresh();
        discovery.result = () -> {
            throw new IllegalStateException("registry unavailable");
        };
        time.set(TimeUnit.SECONDS.toNanos(5));
        Assert.assertEquals(1, service.resources("").size());
        for (int i = 0; i < 10; i++) {
            Assert.assertEquals(1, service.resources("/gateway").size());
        }
        Assert.assertEquals(2, discovery.calls.get());
        discovery.result = Collections::emptyList;
        time.set(TimeUnit.SECONDS.toNanos(10));
        Assert.assertTrue(service.resources("").isEmpty());
        Assert.assertEquals(3, discovery.calls.get());
    }

    @Test
    public void successfulEmptySnapshotRemainsUsableAfterFailure() {
        service.refresh();
        discovery.result = () -> {
            throw new IllegalStateException("registry unavailable");
        };
        time.set(TimeUnit.SECONDS.toNanos(5));
        Assert.assertTrue(service.resources("").isEmpty());
        Assert.assertEquals(2, discovery.calls.get());
    }

    @Test
    public void coldFailureReturns503UntilRetrySucceeds() {
        discovery.result = () -> {
            throw new IllegalStateException("registry unavailable");
        };
        service.refresh();
        for (int i = 0; i < 2; i++) {
            ResponseStatusException failure = Assert.assertThrows(ResponseStatusException.class,
                    () -> service.resources(""));
            Assert.assertEquals(503, failure.getStatusCode().value());
        }
        Assert.assertEquals(1, discovery.calls.get());
        discovery.result = () -> List.of("user-service");
        time.set(TimeUnit.SECONDS.toNanos(5));
        Assert.assertEquals(1, service.resources("").size());
        Assert.assertEquals(2, discovery.calls.get());
    }

    @Test
    public void concurrentExpiredReadsShareOneQueryAndServePreviousSnapshot() throws Exception {
        discovery.result = () -> List.of("user-service");
        service.refresh();
        time.set(TimeUnit.SECONDS.toNanos(5));
        CountDownLatch querying = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        discovery.result = () -> {
            querying.countDown();
            await(release);
            return Collections.emptyList();
        };
        ExecutorService executor = Executors.newFixedThreadPool(8);
        try {
            Future<List<MvcOpenApiResource>> refreshing = executor.submit(() -> service.resources(""));
            Assert.assertTrue(querying.await(5, TimeUnit.SECONDS));
            List<Future<List<MvcOpenApiResource>>> readers = new ArrayList<>();
            for (int i = 0; i < 16; i++) {
                readers.add(executor.submit(() -> service.resources("/gateway")));
            }
            for (Future<List<MvcOpenApiResource>> reader : readers) {
                Assert.assertEquals("/gateway/users/v3/api-docs", reader.get(5, TimeUnit.SECONDS).get(0).getUrl());
            }
            Assert.assertEquals(2, discovery.calls.get());
            release.countDown();
            Assert.assertTrue(refreshing.get(5, TimeUnit.SECONDS).isEmpty());
            Assert.assertTrue(service.resources("").isEmpty());
            Assert.assertEquals(2, discovery.calls.get());
        } finally {
            release.countDown();
            executor.shutdownNow();
            Assert.assertTrue(executor.awaitTermination(5, TimeUnit.SECONDS));
        }
    }

    @Test
    public void eventDuringRequestRefreshIsSerializedAndNotLost() throws Exception {
        service.refresh();
        time.set(TimeUnit.SECONDS.toNanos(5));
        CountDownLatch querying = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        discovery.result = () -> {
            querying.countDown();
            await(release);
            return Collections.emptyList();
        };
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<?> request = executor.submit(() -> service.resources(""));
            Assert.assertTrue(querying.await(5, TimeUnit.SECONDS));
            discovery.result = () -> List.of("user-service");
            Future<?> event = executor.submit(service::refresh);
            release.countDown();
            request.get(5, TimeUnit.SECONDS);
            event.get(5, TimeUnit.SECONDS);
            Assert.assertEquals(1, service.resources("").size());
            Assert.assertEquals(3, discovery.calls.get());
        } finally {
            release.countDown();
            executor.shutdownNow();
            Assert.assertTrue(executor.awaitTermination(5, TimeUnit.SECONDS));
        }
    }

    private MvcGatewayDiscoveryService service() {
        GatewayMvcProperties gateway = new GatewayMvcProperties();
        RouteProperties route = new RouteProperties();
        route.setId("user-service");
        route.setUri(URI.create("lb://user-service"));
        PredicateProperties path = new PredicateProperties();
        path.setName("Path");
        path.getArgs().put("_genkey_0", "/users/**");
        route.getPredicates().add(path);
        gateway.getRoutes().add(route);
        return new MvcGatewayDiscoveryService(discovery, gateway, new Knife4jGatewayMvcProperties(),
                new StandardEnvironment(), time::get);
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(5, TimeUnit.SECONDS)) {
                throw new IllegalStateException("Timed out waiting for test query release");
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(exception);
        }
    }

    private static final class TestDiscoveryClient implements DiscoveryClient {

        private final AtomicInteger calls = new AtomicInteger();
        private volatile Supplier<List<String>> result = Collections::emptyList;

        @Override
        public String description() {
            return "cache-test";
        }

        @Override
        public List<ServiceInstance> getInstances(String serviceId) {
            return Collections.emptyList();
        }

        @Override
        public List<String> getServices() {
            calls.incrementAndGet();
            return result.get();
        }
    }
}
