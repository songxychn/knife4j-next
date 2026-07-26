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
import com.github.xiaoymin.knife4j.aggre.core.pojo.SwaggerRoute;
import com.github.xiaoymin.knife4j.aggre.disk.DiskRoute;
import com.github.xiaoymin.knife4j.aggre.eureka.EurekaInstance;
import com.github.xiaoymin.knife4j.aggre.eureka.EurekaRoute;
import com.github.xiaoymin.knife4j.aggre.spring.support.OpenAPIV3Setting;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.Test;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.lang.reflect.Proxy;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AggregationBehaviorCompatibilityTest {

    @Test
    void routeIdentifiersRemainStableForUtf8Configuration() {
        CloudRoute cloudRoute = new CloudRoute();
        cloudRoute.setName("服务-A");
        cloudRoute.setLocation("/v3/api-docs");
        cloudRoute.setSwaggerVersion("3.0");
        cloudRoute.setServicePath("/gateway");
        cloudRoute.setOrder(2);

        DiskRoute diskRoute = new DiskRoute();
        diskRoute.setName("服务-A");
        diskRoute.setHost("https://example.com");
        diskRoute.setLocation("/v3/api-docs");
        diskRoute.setSwaggerVersion("3.0");
        diskRoute.setServicePath("/gateway");
        diskRoute.setOrder(2);

        assertEquals("e3b5469279e0fd411075c2b9a31adce7", cloudRoute.pkId());
        assertEquals("972f8cd1d15117dcc825c23dcc1a055f", diskRoute.pkId());
    }

    @Test
    void swaggerRouteKeepsUrlAndPathNormalization() {
        CloudRoute route = new CloudRoute();
        route.setUri("example.com");
        route.setServicePath("gateway");

        SwaggerRoute swaggerRoute = new SwaggerRoute(route);
        assertEquals("http://example.com", swaggerRoute.getUri());
        assertEquals("/gateway", swaggerRoute.getServicePath());

        route.setUri("https://example.com");
        route.setServicePath("https://gateway.example.com");
        swaggerRoute = new SwaggerRoute(route);
        assertEquals("https://example.com", swaggerRoute.getUri());
        assertEquals("https://gateway.example.com", swaggerRoute.getServicePath());

        route.setUri("HTTPS://example.com");
        swaggerRoute = new SwaggerRoute(route);
        assertEquals("http://HTTPS://example.com", swaggerRoute.getUri());

        route.setUri("http://example.com\npath");
        swaggerRoute = new SwaggerRoute(route);
        assertEquals("http://example.com\npath", swaggerRoute.getUri());

        route.setUri(" \t");
        route.setServicePath(" \t");
        swaggerRoute = new SwaggerRoute(route);
        assertNull(swaggerRoute.getUri());
        assertNull(swaggerRoute.getServicePath());

        route.setUri("\u00a0\ufeff\0\u3164\u2800\u180e");
        route.setServicePath("\u00a0\ufeff\0\u3164\u2800\u180e");
        swaggerRoute = new SwaggerRoute(route);
        assertNull(swaggerRoute.getUri());
        assertNull(swaggerRoute.getServicePath());

        swaggerRoute = new SwaggerRoute(new CloudRoute());
        assertNull(swaggerRoute.getUri());
        assertNull(swaggerRoute.getServicePath());
    }

    @Test
    void eurekaPortKeepsNumberAndDefaultParsing() {
        EurekaRoute route = new EurekaRoute();
        EurekaInstance instance = new EurekaInstance();
        instance.setIpAddr("127.0.0.1");
        instance.setPort(Collections.singletonMap("$", 8080.0d));

        assertEquals("http://127.0.0.1:8080", new SwaggerRoute(route, instance).getUri());

        instance.setPort(Collections.singletonMap("$", null));
        assertEquals("http://127.0.0.1:80", new SwaggerRoute(route, instance).getUri());
    }

    @Test
    void defaultErrorResponseKeepsJsonContract() {
        StringWriter body = new StringWriter();
        String[] contentType = new String[1];
        String[] characterEncoding = new String[1];
        HttpServletRequest request = request("/代理/<route>");
        HttpServletResponse response = response(body, contentType, characterEncoding);

        dispatcher().writeDefault(request, response, "调用失败 \"<&>");

        JsonObject json = JsonParser.parseString(body.toString()).getAsJsonObject();
        assertEquals("调用失败 \"<&>", json.get("message").getAsString());
        assertEquals("500", json.get("code").getAsString());
        assertEquals("/代理/<route>", json.get("path").getAsString());
        assertEquals("application/json", contentType[0]);
        assertEquals("UTF-8", characterEncoding[0]);
        assertTrue(body.toString().contains("<&>"));

        StringWriter nullMessageBody = new StringWriter();
        dispatcher().writeDefault(request, response(nullMessageBody, new String[1], new String[1]), null);
        assertTrue(JsonParser.parseString(nullMessageBody.toString()).getAsJsonObject().get("message").isJsonNull());
    }

    private static RouteDispatcher dispatcher() {
        RouteRepository repository = new RouteRepository() {

            @Override
            public boolean checkRoute(String header) {
                return false;
            }

            @Override
            public SwaggerRoute getRoute(String header) {
                return null;
            }

            @Override
            public List<SwaggerRoute> getRoutes() {
                return Collections.emptyList();
            }
        };
        return new RouteDispatcher(repository, new RouteInMemoryCache(), ExecutorEnum.APACHE, "",
                new OpenAPIV3Setting());
    }

    private static HttpServletRequest request(String requestUri) {
        return (HttpServletRequest) Proxy.newProxyInstance(
                HttpServletRequest.class.getClassLoader(),
                new Class<?>[]{HttpServletRequest.class},
                (proxy, method, args) -> "getRequestURI".equals(method.getName()) ? requestUri : null);
    }

    private static HttpServletResponse response(StringWriter body, String[] contentType, String[] characterEncoding) {
        PrintWriter writer = new PrintWriter(body);
        return (HttpServletResponse) Proxy.newProxyInstance(
                HttpServletResponse.class.getClassLoader(),
                new Class<?>[]{HttpServletResponse.class},
                (proxy, method, args) -> {
                    switch (method.getName()) {
                        case "getWriter":
                            return writer;
                        case "setContentType":
                            contentType[0] = (String) args[0];
                            return null;
                        case "setCharacterEncoding":
                            characterEncoding[0] = (String) args[0];
                            return null;
                        default:
                            return null;
                    }
                });
    }
}
