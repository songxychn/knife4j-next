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


package com.github.xiaoymin.knife4j.aggre.core;

import com.github.xiaoymin.knife4j.aggre.cloud.CloudRoute;
import com.github.xiaoymin.knife4j.aggre.core.cache.RouteInMemoryCache;
import com.github.xiaoymin.knife4j.aggre.core.common.ExecutorEnum;
import com.github.xiaoymin.knife4j.aggre.core.executor.ApacheClientExecutor;
import com.github.xiaoymin.knife4j.aggre.core.pojo.HeaderWrapper;
import com.github.xiaoymin.knife4j.aggre.repository.CloudRepository;
import com.github.xiaoymin.knife4j.aggre.spring.support.CloudSetting;
import com.github.xiaoymin.knife4j.aggre.spring.support.OpenAPIV3Setting;
import com.sun.net.httpserver.HttpServer;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;

import java.io.IOException;
import java.io.OutputStream;
import java.lang.reflect.Proxy;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * 回归 #679：聚合转发的 Host 必须保留目标端口，且不能带入 URI 用户信息。
 */
class RouteDispatcherHostTest {

    @TestFactory
    Stream<DynamicTest> buildsHostFromTargetHostAndExplicitPort() {
        String[][] cases = {
                {"http://docs.example:18080", "docs.example:18080"},
                {"https://docs.example:8443", "docs.example:8443"},
                {"http://docs.example:80", "docs.example:80"},
                {"https://docs.example:443", "docs.example:443"},
                {"http://docs.example", "docs.example"},
                {"https://docs.example", "docs.example"},
                {"http://127.0.0.1:18080", "127.0.0.1:18080"},
                {"http://[2001:db8::1]:18080", "[2001:db8::1]:18080"},
                {"http://[2001:db8::1]", "[2001:db8::1]"},
                {"http://demo:placeholder@docs.example:18080", "docs.example:18080"}
        };
        return Arrays.stream(cases).map(testCase -> DynamicTest.dynamicTest(testCase[0], () -> {
            RouteRequestContext context = buildContext(testCase[0], null, "/v3/api-docs");
            List<String> hosts = context.getHeaders().stream()
                    .filter(header -> "Host".equalsIgnoreCase(header.getName()))
                    .map(HeaderWrapper::getValue)
                    .collect(Collectors.toList());
            assertEquals(Collections.singletonList(testCase[1]), hosts,
                    "必须替换入口 Host，且只发送一个目标 Host");
            assertEquals(testCase[0] + "/v3/api-docs", context.getUrl());
            assertEquals("/v3/api-docs", context.getOriginalUri());
        }));
    }

    @Test
    void forwardsCloudDocumentHostWithPortOverHttp() throws IOException {
        assertHttpForwarding("/v3/api-docs", false);
    }

    @Test
    void forwardsDebugTargetHostWithPortOverHttp() throws IOException {
        assertHttpForwarding("/users", true);
    }

    private void assertHttpForwarding(String path, boolean debugRequest) throws IOException {
        HttpServer downstream = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        downstream.createContext("/", exchange -> {
            String received = exchange.getRequestHeaders().getFirst("Host") + "\n"
                    + exchange.getRequestURI().getRawPath();
            byte[] body = received.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "text/plain;charset=UTF-8");
            exchange.sendResponseHeaders(200, body.length);
            try (OutputStream output = exchange.getResponseBody()) {
                output.write(body);
            }
        });
        downstream.start();
        try {
            String authority = "127.0.0.1:" + downstream.getAddress().getPort();
            String target = "http://" + authority;
            String documentUri = debugRequest ? "http://documents.example:18080" : target;
            String debugUri = debugRequest ? target : "http://debug.example:18081";
            RouteRequestContext context = buildContext(documentUri, debugUri, path);
            assertEquals(target + path, context.getUrl());

            RouteResponse response = new ApacheClientExecutor(1000).executor(context);
            assertEquals(200, response.getStatusCode());
            assertEquals(authority + "\n" + path, response.text(),
                    "下游实际收到的 Host 必须包含目标端口");
        } finally {
            downstream.stop(0);
        }
    }

    private RouteRequestContext buildContext(String uri, String debugUri, String path) throws IOException {
        CloudRoute route = new CloudRoute();
        route.setName("host-port-regression");
        route.setUri(uri);
        route.setLocation("/v3/api-docs");
        route.setServicePath("/service");
        route.setDebugUrl(debugUri);
        CloudSetting setting = new CloudSetting();
        setting.setEnable(true);
        setting.setRoutes(Collections.singletonList(route));
        CloudRepository repository = new CloudRepository(setting);
        RouteDispatcher dispatcher = new RouteDispatcher(repository, new RouteInMemoryCache(),
                ExecutorEnum.APACHE, "/aggregate", new OpenAPIV3Setting());
        HttpServletRequest request = (HttpServletRequest) Proxy.newProxyInstance(
                HttpServletRequest.class.getClassLoader(),
                new Class<?>[]{HttpServletRequest.class},
                (proxy, method, args) -> {
                    switch (method.getName()) {
                        case "getRequestURI":
                            return "/aggregate/service" + path;
                        case "getMethod":
                            return "GET";
                        case "getHeaderNames":
                            return Collections.enumeration(Arrays.asList("hOsT", RouteDispatcher.ROUTE_PROXY_HEADER_NAME));
                        case "getHeader":
                            if ("Host".equalsIgnoreCase((String) args[0])) {
                                return "gateway.example:19090";
                            }
                            if (RouteDispatcher.ROUTE_PROXY_HEADER_NAME.equals(args[0])) {
                                return route.pkId();
                            }
                            return null;
                        case "getParameterNames":
                            return Collections.enumeration(Collections.emptyList());
                        case "getContentType":
                        case "getInputStream":
                            return null;
                        default:
                            throw new UnsupportedOperationException("Unexpected request method: " + method.getName());
                    }
                });
        RouteRequestContext context = new RouteRequestContext();
        dispatcher.buildContext(context, request);
        return context;
    }
}
