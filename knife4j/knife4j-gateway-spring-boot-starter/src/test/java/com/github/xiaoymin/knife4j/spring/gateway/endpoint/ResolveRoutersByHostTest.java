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

package com.github.xiaoymin.knife4j.spring.gateway.endpoint;

import com.github.xiaoymin.knife4j.spring.gateway.Knife4jGatewayProperties;
import org.junit.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.server.reactive.ServerHttpRequest;

import java.lang.reflect.Proxy;
import java.net.URI;
import java.util.*;

import static org.junit.Assert.*;

/**
 * Unit tests for {@link OpenAPIEndpoint#resolveRoutersByHost(ServerHttpRequest)}.
 * Covers: host matching, X-Forwarded-Host priority, fallback to global routes,
 * and {@link Knife4jGatewayProperties#getRoutesByHost()} POJO binding.
 */
public class ResolveRoutersByHostTest {

    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------

    /** Build a minimal ServerHttpRequest proxy for the given URI host and optional X-Forwarded-Host. */
    private static ServerHttpRequest mockRequest(String uriHost, String forwardedHost) {
        HttpHeaders headers = new HttpHeaders();
        if (forwardedHost != null) {
            headers.set("X-Forwarded-Host", forwardedHost);
        }
        URI uri = URI.create("http://" + uriHost + "/v3/api-docs/swagger-config");

        return (ServerHttpRequest) Proxy.newProxyInstance(
                ServerHttpRequest.class.getClassLoader(),
                new Class[]{ServerHttpRequest.class},
                (proxy, method, args) -> {
                    if ("getHeaders".equals(method.getName())) return headers;
                    if ("getURI".equals(method.getName())) return uri;
                    return null;
                });
    }

    /** Build a Router with the given name. */
    private static Knife4jGatewayProperties.Router router(String name) {
        Knife4jGatewayProperties.Router r = new Knife4jGatewayProperties.Router();
        r.setName(name);
        return r;
    }

    /** Build an OpenAPIEndpoint with the given properties (no ApplicationContext needed for unit tests). */
    private static OpenAPIEndpoint endpoint(Knife4jGatewayProperties props) {
        return new OpenAPIEndpoint(props, null);
    }

    // ---------------------------------------------------------------------------
    // Knife4jGatewayProperties POJO binding tests
    // ---------------------------------------------------------------------------

    @Test
    public void routesByHost_defaultIsEmptyMap() {
        Knife4jGatewayProperties props = new Knife4jGatewayProperties();
        assertNotNull(props.getRoutesByHost());
        assertTrue(props.getRoutesByHost().isEmpty());
    }

    @Test
    public void routesByHost_setterAndGetterWork() {
        Knife4jGatewayProperties props = new Knife4jGatewayProperties();
        Map<String, List<Knife4jGatewayProperties.Router>> map = new HashMap<>();
        map.put("api.example.com", Collections.singletonList(router("svc-a")));
        props.setRoutesByHost(map);

        assertEquals(1, props.getRoutesByHost().size());
        assertEquals("svc-a", props.getRoutesByHost().get("api.example.com").get(0).getName());
    }

    // ---------------------------------------------------------------------------
    // resolveRoutersByHost logic tests
    // ---------------------------------------------------------------------------

    @Test
    public void resolveRoutersByHost_noRoutesConfigured_returnsGlobalRoutes() {
        Knife4jGatewayProperties props = new Knife4jGatewayProperties();
        props.getRoutes().add(router("global-svc"));

        OpenAPIEndpoint ep = endpoint(props);
        List<Knife4jGatewayProperties.Router> result =
                ep.resolveRoutersByHost(mockRequest("api.example.com", null));

        assertEquals(1, result.size());
        assertEquals("global-svc", result.get(0).getName());
    }

    @Test
    public void resolveRoutersByHost_hostMatches_returnsHostRoutes() {
        Knife4jGatewayProperties props = new Knife4jGatewayProperties();
        props.getRoutes().add(router("global-svc"));

        Map<String, List<Knife4jGatewayProperties.Router>> byHost = new HashMap<>();
        byHost.put("api.internal.example.com", Collections.singletonList(router("internal-svc")));
        props.setRoutesByHost(byHost);

        OpenAPIEndpoint ep = endpoint(props);
        List<Knife4jGatewayProperties.Router> result =
                ep.resolveRoutersByHost(mockRequest("api.internal.example.com", null));

        assertEquals(1, result.size());
        assertEquals("internal-svc", result.get(0).getName());
    }

    @Test
    public void resolveRoutersByHost_hostNoMatch_fallsBackToGlobalRoutes() {
        Knife4jGatewayProperties props = new Knife4jGatewayProperties();
        props.getRoutes().add(router("global-svc"));

        Map<String, List<Knife4jGatewayProperties.Router>> byHost = new HashMap<>();
        byHost.put("api.internal.example.com", Collections.singletonList(router("internal-svc")));
        props.setRoutesByHost(byHost);

        OpenAPIEndpoint ep = endpoint(props);
        List<Knife4jGatewayProperties.Router> result =
                ep.resolveRoutersByHost(mockRequest("api.other.example.com", null));

        assertEquals(1, result.size());
        assertEquals("global-svc", result.get(0).getName());
    }

    @Test
    public void resolveRoutersByHost_xForwardedHostTakesPriority() {
        Knife4jGatewayProperties props = new Knife4jGatewayProperties();
        props.getRoutes().add(router("global-svc"));

        Map<String, List<Knife4jGatewayProperties.Router>> byHost = new HashMap<>();
        byHost.put("api.public.example.com", Collections.singletonList(router("public-svc")));
        props.setRoutesByHost(byHost);

        OpenAPIEndpoint ep = endpoint(props);
        // URI host is "internal.example.com" but X-Forwarded-Host is "api.public.example.com"
        List<Knife4jGatewayProperties.Router> result =
                ep.resolveRoutersByHost(mockRequest("internal.example.com", "api.public.example.com"));

        assertEquals(1, result.size());
        assertEquals("public-svc", result.get(0).getName());
    }

    @Test
    public void resolveRoutersByHost_xForwardedHostNoMatch_fallsBackToGlobalRoutes() {
        Knife4jGatewayProperties props = new Knife4jGatewayProperties();
        props.getRoutes().add(router("global-svc"));

        Map<String, List<Knife4jGatewayProperties.Router>> byHost = new HashMap<>();
        byHost.put("api.internal.example.com", Collections.singletonList(router("internal-svc")));
        props.setRoutesByHost(byHost);

        OpenAPIEndpoint ep = endpoint(props);
        // X-Forwarded-Host present but doesn't match any key
        List<Knife4jGatewayProperties.Router> result =
                ep.resolveRoutersByHost(mockRequest("api.internal.example.com", "api.unknown.example.com"));

        assertEquals(1, result.size());
        assertEquals("global-svc", result.get(0).getName());
    }

    @Test
    public void resolveRoutersByHost_doesNotMutateSharedList() {
        Knife4jGatewayProperties props = new Knife4jGatewayProperties();

        Knife4jGatewayProperties.Router r1 = router("svc-b");
        r1.setOrder(2);
        Knife4jGatewayProperties.Router r2 = router("svc-a");
        r2.setOrder(1);

        Map<String, List<Knife4jGatewayProperties.Router>> byHost = new HashMap<>();
        List<Knife4jGatewayProperties.Router> hostList = new ArrayList<>(Arrays.asList(r1, r2));
        byHost.put("api.example.com", hostList);
        props.setRoutesByHost(byHost);

        OpenAPIEndpoint ep = endpoint(props);
        // Call resolveRoutersByHost — the returned list is the shared list (not sorted yet)
        List<Knife4jGatewayProperties.Router> returned = ep.resolveRoutersByHost(mockRequest("api.example.com", null));

        // The returned list should still be in original insertion order (not sorted by the endpoint)
        assertEquals("svc-b", returned.get(0).getName());
        assertEquals("svc-a", returned.get(1).getName());
    }
}
