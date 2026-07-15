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

import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.cloud.client.discovery.DiscoveryClient;
import org.springframework.cloud.client.discovery.event.HeartbeatEvent;
import org.springframework.cloud.gateway.server.mvc.config.GatewayMvcProperties;
import org.springframework.cloud.gateway.server.mvc.config.PredicateProperties;
import org.springframework.cloud.gateway.server.mvc.config.RouteProperties;
import org.springframework.context.event.EventListener;
import org.springframework.core.env.Environment;
import org.springframework.util.StringUtils;

import java.net.URI;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Discovers documents only for explicitly configured MVC Gateway {@code lb://}
 * routes. It never creates Gateway routes from registry entries.
 */
@Slf4j
final class MvcGatewayDiscoveryService {

    private final DiscoveryClient discoveryClient;
    private final GatewayMvcProperties gatewayProperties;
    private final Knife4jGatewayMvcProperties knife4jProperties;
    private final Environment environment;
    private volatile List<MvcOpenApiResource> resources = Collections.emptyList();

    MvcGatewayDiscoveryService(DiscoveryClient discoveryClient, GatewayMvcProperties gatewayProperties,
                               Knife4jGatewayMvcProperties knife4jProperties, Environment environment) {
        this.discoveryClient = discoveryClient;
        this.gatewayProperties = gatewayProperties;
        this.knife4jProperties = knife4jProperties;
        this.environment = environment;
    }

    boolean isAvailable() {
        return discoveryClient != null;
    }

    @EventListener({ApplicationReadyEvent.class, HeartbeatEvent.class})
    public void refresh() {
        if (discoveryClient == null) {
            resources = Collections.emptyList();
            return;
        }

        List<String> services = discoveryClient.getServices();
        Set<String> excluded = excludedServices();
        List<MvcOpenApiResource> refreshed = new ArrayList<>();
        for (RouteProperties route : configuredRoutes()) {
            addRouteResources(refreshed, route, services, excluded);
        }
        for (Knife4jGatewayMvcProperties.Router route : knife4jProperties.getRoutes()) {
            refreshed.add(MvcOpenApiResource.manual(route));
        }
        Collections.sort(refreshed);
        resources = Collections.unmodifiableList(refreshed);
        log.debug("Refreshed {} MVC Gateway OpenAPI resources", refreshed.size());
    }

    List<MvcOpenApiResource> resources(String basePath) {
        List<MvcOpenApiResource> result = new ArrayList<>();
        for (MvcOpenApiResource resource : resources) {
            result.add(resource.withBasePath(basePath));
        }
        return result;
    }

    private Collection<RouteProperties> configuredRoutes() {
        List<RouteProperties> routes = new ArrayList<>(gatewayProperties.getRoutes());
        routes.addAll(gatewayProperties.getRoutesMap().values());
        return routes;
    }

    private void addRouteResources(List<MvcOpenApiResource> target, RouteProperties route, List<String> services,
                                   Set<String> excluded) {
        URI uri = route.getUri();
        if (uri == null || !"lb".equalsIgnoreCase(uri.getScheme()) || !StringUtils.hasText(uri.getHost())) {
            return;
        }
        String serviceName = uri.getHost();
        if (!containsIgnoreCase(services, serviceName) || excluded(serviceName, excluded)) {
            return;
        }
        for (String prefix : pathPrefixes(route.getPredicates())) {
            addResource(target, serviceName, prefix);
        }
    }

    private void addResource(List<MvcOpenApiResource> target, String serviceName, String prefix) {
        Knife4jGatewayMvcProperties.ServiceConfigInfo config = findServiceConfig(serviceName);
        String name = StringUtils.hasText(config.getGroupName()) ? config.getGroupName() : serviceName;
        String contextPath = StringUtils.hasText(config.getContextPath()) ? config.getContextPath() : prefix;
        String url = MvcPathUtils.append(prefix, knife4jProperties.getDiscover().getApiDocsPath());
        List<String> groups = config.getGroupNames();
        if (groups == null || groups.isEmpty()) {
            target.add(MvcOpenApiResource.discovered(name, serviceName, url, contextPath, config.getOrder()));
            return;
        }
        for (String group : groups) {
            String groupUrl = url + (url.contains("?") ? "&" : "?") + "group=" + group;
            target.add(MvcOpenApiResource.discovered(name + " (" + group + ")", serviceName, groupUrl,
                    contextPath, config.getOrder()));
        }
    }

    private Knife4jGatewayMvcProperties.ServiceConfigInfo findServiceConfig(String serviceName) {
        for (Map.Entry<String, Knife4jGatewayMvcProperties.ServiceConfigInfo> entry : knife4jProperties.getDiscover().getServiceConfig().entrySet()) {
            if (entry.getKey().equalsIgnoreCase(serviceName)) {
                return entry.getValue();
            }
        }
        return new Knife4jGatewayMvcProperties.ServiceConfigInfo();
    }

    private List<String> pathPrefixes(List<PredicateProperties> predicates) {
        List<String> prefixes = new ArrayList<>();
        for (PredicateProperties predicate : predicates) {
            if (!"Path".equalsIgnoreCase(predicate.getName())) {
                continue;
            }
            for (String pattern : predicate.getArgs().values()) {
                prefixes.add(MvcPathUtils.routePrefix(pattern));
            }
        }
        return prefixes;
    }

    private Set<String> excludedServices() {
        Set<String> excluded = new LinkedHashSet<>(knife4jProperties.getDiscover().getExcludedServices());
        String applicationName = environment.getProperty("spring.application.name");
        if (StringUtils.hasText(applicationName)) {
            excluded.add(applicationName);
        }
        return excluded;
    }

    private boolean excluded(String serviceName, Set<String> excluded) {
        for (String rule : excluded) {
            if (rule.equalsIgnoreCase(serviceName)
                    || Pattern.compile(rule, Pattern.CASE_INSENSITIVE).matcher(serviceName).matches()) {
                return true;
            }
        }
        return false;
    }

    private boolean containsIgnoreCase(List<String> values, String expected) {
        String normalizedExpected = expected.toLowerCase(Locale.ROOT);
        return values.stream().map(value -> value.toLowerCase(Locale.ROOT)).anyMatch(normalizedExpected::equals);
    }
}
