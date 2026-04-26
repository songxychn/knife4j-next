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

package com.github.xiaoymin.knife4j.spring.gateway.test.discover;

import com.github.xiaoymin.knife4j.spring.gateway.Knife4jGatewayProperties;
import com.github.xiaoymin.knife4j.spring.gateway.discover.ServiceDiscoverHandler;
import com.github.xiaoymin.knife4j.spring.gateway.discover.ServiceRouterHolder;
import com.github.xiaoymin.knife4j.spring.gateway.discover.router.DiscoverClientRouteServiceConvert;
import com.github.xiaoymin.knife4j.spring.gateway.enums.OpenApiVersion;
import com.github.xiaoymin.knife4j.spring.gateway.spec.v2.OpenAPI2Resource;
import org.junit.Assert;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.runners.JUnit4;
import org.springframework.cloud.client.DefaultServiceInstance;
import org.springframework.cloud.client.ServiceInstance;
import org.springframework.cloud.client.discovery.ReactiveDiscoveryClient;
import org.springframework.cloud.gateway.discovery.DiscoveryClientRouteDefinitionLocator;
import org.springframework.cloud.gateway.discovery.DiscoveryLocatorProperties;
import org.springframework.cloud.gateway.handler.predicate.PredicateDefinition;
import reactor.core.publisher.Flux;

import java.util.*;

/**
 * Smoke test verifying SC 2025 compatibility fix for DiscoverClientRouteServiceConvert.
 *
 * <p>In Spring Cloud 2025 / Spring Boot 3.5+, calling {@code .subscribe()} on
 * {@code DiscoveryClientRouteDefinitionLocator.getRouteDefinitions()} from a non-reactor
 * thread throws an {@code IllegalStateException}. The fix uses
 * {@code .collectList().subscribeOn(Schedulers.boundedElastic()).block()} instead.
 *
 * @see <a href="https://github.com/xiaoymin/knife4j/issues/939">knife4j#939</a>
 */
@RunWith(JUnit4.class)
public class DiscoverClientRouteServiceConvertSC2025Test {

    /**
     * Builds a ReactiveDiscoveryClient stub that returns the given service IDs.
     * Each service gets a single instance at localhost:8080.
     */
    private ReactiveDiscoveryClient stubDiscoveryClient(List<String> serviceIds) {
        return new ReactiveDiscoveryClient() {
            @Override
            public String description() {
                return "stub";
            }

            @Override
            public Flux<ServiceInstance> getInstances(String serviceId) {
                DefaultServiceInstance instance = new DefaultServiceInstance(
                        serviceId + "-1", serviceId, "localhost", 8080, false);
                return Flux.just(instance);
            }

            @Override
            public Flux<String> getServices() {
                return Flux.fromIterable(serviceIds);
            }
        };
    }

    private DiscoveryClientRouteDefinitionLocator buildLocator(List<String> serviceIds) {
        DiscoveryLocatorProperties props = new DiscoveryLocatorProperties();
        props.setEnabled(true);
        // Add the default Path predicate that Spring Boot auto-config normally provides.
        // Without this, getRouteDefinitions() returns routes with empty predicates lists.
        PredicateDefinition pathPredicate = new PredicateDefinition();
        pathPredicate.setName("Path");
        Map<String, String> args = new LinkedHashMap<>();
        args.put("_genkey_0", "'/'+serviceId+'/**'");
        pathPredicate.setArgs(args);
        props.setPredicates(Collections.singletonList(pathPredicate));
        return new DiscoveryClientRouteDefinitionLocator(stubDiscoveryClient(serviceIds), props);
    }

    private Knife4jGatewayProperties buildGatewayProperties() {
        Knife4jGatewayProperties props = new Knife4jGatewayProperties();
        props.getDiscover().setEnabled(true);
        props.getDiscover().setVersion(OpenApiVersion.OpenAPI3);
        return props;
    }

    /**
     * Verifies that process() correctly discovers services when called from a plain (non-reactor) thread.
     * This is the SC 2025 regression scenario — the old .subscribe() approach would silently drop
     * results or throw when called outside a reactor context.
     */
    @Test
    public void process_shouldDiscoverServicesFromNonReactorThread() {
        List<String> services = Arrays.asList("user-service", "order-service");
        DiscoveryClientRouteDefinitionLocator locator = buildLocator(services);
        Knife4jGatewayProperties props = buildGatewayProperties();

        DiscoverClientRouteServiceConvert convert = new DiscoverClientRouteServiceConvert(locator, props);

        ServiceDiscoverHandler handler = new ServiceDiscoverHandler(props);
        ServiceRouterHolder holder = new ServiceRouterHolder(services, Collections.emptySet(), handler);

        // Must not throw — this is the SC 2025 compatibility assertion
        convert.process(holder);

        Set<OpenAPI2Resource> resources = handler.getGatewayResources();
        Assert.assertFalse("Expected at least one discovered service resource", resources.isEmpty());
    }

    /**
     * Verifies that excluded services are not added to the holder.
     */
    @Test
    public void process_shouldRespectExcludeList() {
        List<String> services = Arrays.asList("user-service", "order-service", "gateway");
        DiscoveryClientRouteDefinitionLocator locator = buildLocator(services);
        Knife4jGatewayProperties props = buildGatewayProperties();

        DiscoverClientRouteServiceConvert convert = new DiscoverClientRouteServiceConvert(locator, props);

        ServiceDiscoverHandler handler = new ServiceDiscoverHandler(props);
        Set<String> excluded = new HashSet<>(Collections.singletonList("gateway"));
        ServiceRouterHolder holder = new ServiceRouterHolder(services, excluded, handler);

        convert.process(holder);

        for (OpenAPI2Resource r : handler.getGatewayResources()) {
            Assert.assertNotEquals("gateway should be excluded", "gateway", r.getServiceName());
        }
    }
}















