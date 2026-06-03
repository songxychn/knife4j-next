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
import com.github.xiaoymin.knife4j.aggre.conf.GlobalConstants;
import com.github.xiaoymin.knife4j.aggre.core.cache.RouteInMemoryCache;
import com.github.xiaoymin.knife4j.aggre.core.common.ExecutorEnum;
import com.github.xiaoymin.knife4j.aggre.core.pojo.SwaggerRoute;
import com.github.xiaoymin.knife4j.aggre.repository.CloudRepository;
import com.github.xiaoymin.knife4j.aggre.spec.v2.OpenAPI2Resource;
import com.github.xiaoymin.knife4j.aggre.spec.v3.OpenAPI3Response;
import com.github.xiaoymin.knife4j.aggre.spring.support.CloudSetting;
import com.github.xiaoymin.knife4j.aggre.spring.support.OpenAPIV3Setting;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

import java.util.Collections;
import java.util.List;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Proxy;

/**
 * 回归 issue #421：聚合 starter 最简 cloud 配置访问 {@code /v3/api-docs/swagger-config} 返回 500。
 *
 * <p>原因是 {@link com.github.xiaoymin.knife4j.aggre.cloud.CloudRoute} 未配置 {@code servicePath}
 * 时，{@link SwaggerRoute#getServicePath()} 为 {@code null}，进入
 * {@link com.github.xiaoymin.knife4j.aggre.utils.PathUtils#processContextPath(String)} 触发
 * {@link NullPointerException}，导致 {@code getOpenAPI3Response} 整体抛错。
 */
class RouteDispatcherSwaggerConfigTest {

    @Test
    void getOpenAPI3Response_shouldNotThrow_whenServicePathIsNull() {
        // 复现 issue #421 上报的最简 cloud 配置
        CloudRoute cloudRoute = new CloudRoute();
        cloudRoute.setName("openapi3-demo");
        cloudRoute.setUri("https://openapi3.demo.knife4jnext.com");
        cloudRoute.setLocation("/v3/api-docs");
        cloudRoute.setSwaggerVersion("3.0");
        cloudRoute.setOrder(2);
        // 故意不设置 servicePath，复刻用户最简配置

        CloudSetting cloudSetting = new CloudSetting();
        cloudSetting.setEnable(true);
        cloudSetting.setRoutes(Collections.singletonList(cloudRoute));

        CloudRepository cloudRepository = new CloudRepository(cloudSetting);

        OpenAPIV3Setting openAPIV3Setting = new OpenAPIV3Setting();
        RouteDispatcher dispatcher = new RouteDispatcher(
                cloudRepository,
                new RouteInMemoryCache(),
                ExecutorEnum.APACHE,
                GlobalConstants.DEFAULT_OPEN_API_V3_PATH,
                openAPIV3Setting);

        HttpServletRequest request = stubRequest();

        OpenAPI3Response response = Assertions.assertDoesNotThrow(
                () -> dispatcher.getOpenAPI3Response(request),
                "Aggregation starter must not throw NPE when servicePath is unset (#421)");

        Assertions.assertEquals(GlobalConstants.DEFAULT_OPEN_API_V3_CONFIG_PATH, response.getConfigUrl());
        List<?> urls = response.getUrls();
        Assertions.assertNotNull(urls);
        Assertions.assertEquals(1, urls.size());

        OpenAPI2Resource resource = (OpenAPI2Resource) urls.get(0);
        Assertions.assertEquals("openapi3-demo", resource.getName());
        Assertions.assertEquals("/v3/api-docs", resource.getUrl());
        // 未配置 servicePath 时，contextPath 必须归一化为空字符串，避免拼接出多余的 "/"
        Assertions.assertEquals("", resource.getContextPath());
    }

    /**
     * 构造一个最小的 {@link HttpServletRequest} stub：仅返回空 contextPath 与空 Referer，
     * 用于驱动 {@code RouteDispatcher#getOpenAPI3Response} 中对 contextPath 的解析路径。
     * 通过 JDK 动态代理避免引入 spring-test / mockito 依赖。
     */
    private static HttpServletRequest stubRequest() {
        InvocationHandler handler = (proxy, method, args) -> {
            switch (method.getName()) {
                case "getContextPath":
                    return "";
                case "getHeader":
                    return null;
                case "equals":
                    return proxy == args[0];
                case "hashCode":
                    return System.identityHashCode(proxy);
                case "toString":
                    return "StubHttpServletRequest";
                default:
                    // 未涉及方法返回 null/0/false；接口方法仅原始类型时由代理框架处理。
                    if (method.getReturnType().isPrimitive()) {
                        if (method.getReturnType() == boolean.class) {
                            return false;
                        }
                        return 0;
                    }
                    return null;
            }
        };
        return (HttpServletRequest) Proxy.newProxyInstance(
                HttpServletRequest.class.getClassLoader(),
                new Class<?>[]{HttpServletRequest.class},
                handler);
    }

}
