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


package com.github.xiaoymin.knife4j.spring.gateway.test.utils;

import com.github.xiaoymin.knife4j.spring.gateway.Knife4jGatewayProperties;
import com.github.xiaoymin.knife4j.spring.gateway.enums.OpenApiVersion;
import com.github.xiaoymin.knife4j.spring.gateway.utils.ServiceUtils;
import org.junit.Assert;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.runners.JUnit4;

/**
 * Tests for ServiceUtils.getOpenAPIURL — verifies that context-path is correctly
 * included in the resolved URL so that the gateway can forward /v3/api-docs properly.
 *
 * @since knife4j v4.3.0 (issue #107)
 */
@RunWith(JUnit4.class)
public class ServiceUtilsTest {

    private Knife4jGatewayProperties.Discover discoverOpenAPI3() {
        Knife4jGatewayProperties.Discover discover = new Knife4jGatewayProperties.Discover();
        discover.setVersion(OpenApiVersion.OpenAPI3);
        return discover;
    }

    private Knife4jGatewayProperties.Discover discoverSwagger2() {
        Knife4jGatewayProperties.Discover discover = new Knife4jGatewayProperties.Discover();
        discover.setVersion(OpenApiVersion.Swagger2);
        return discover;
    }

    // ---- OpenAPI3 scenarios ----

    @Test
    public void test_getOpenAPIURL_noContextPath() {
        // 无 context-path（空字符串或 "/"）时，URL 应直接为 /v3/api-docs
        String url = ServiceUtils.getOpenAPIURL(discoverOpenAPI3(), "", null);
        Assert.assertEquals("/v3/api-docs", url);

        url = ServiceUtils.getOpenAPIURL(discoverOpenAPI3(), "/", null);
        Assert.assertEquals("/v3/api-docs", url);
    }

    @Test
    public void test_getOpenAPIURL_contextPathWithLeadingSlash() {
        // context-path 带前导斜杠，URL 应为 /uaa/v3/api-docs
        String url = ServiceUtils.getOpenAPIURL(discoverOpenAPI3(), "/uaa", null);
        Assert.assertEquals("/uaa/v3/api-docs", url);
    }

    @Test
    public void test_getOpenAPIURL_contextPathWithoutLeadingSlash() {
        // context-path 不带前导斜杠（issue #107 核心场景），URL 不应缺少 /
        String url = ServiceUtils.getOpenAPIURL(discoverOpenAPI3(), "uaa", null);
        Assert.assertNotNull(url);
        Assert.assertTrue("URL must start with /", url.startsWith("/"));
        Assert.assertEquals("/uaa/v3/api-docs", url);
    }

    @Test
    public void test_getOpenAPIURL_contextPathWithTrailingSlash() {
        // context-path 带尾部斜杠，URL 不应出现双斜杠
        String url = ServiceUtils.getOpenAPIURL(discoverOpenAPI3(), "/uaa/", null);
        Assert.assertFalse("URL must not contain double slash", url.contains("//"));
        Assert.assertEquals("/uaa/v3/api-docs", url);

        url = ServiceUtils.getOpenAPIURL(discoverOpenAPI3(), "uaa/", null);
        Assert.assertFalse("URL must not contain double slash", url.contains("//"));
        Assert.assertEquals("/uaa/v3/api-docs", url);
    }

    @Test
    public void test_getOpenAPIURL_multiSegmentContextPath() {
        // 多段 context-path，如 /api/v1
        String url = ServiceUtils.getOpenAPIURL(discoverOpenAPI3(), "/api/v1", null);
        Assert.assertEquals("/api/v1/v3/api-docs", url);

        url = ServiceUtils.getOpenAPIURL(discoverOpenAPI3(), "api/v1", null);
        Assert.assertEquals("/api/v1/v3/api-docs", url);

        url = ServiceUtils.getOpenAPIURL(discoverOpenAPI3(), "/api/v1/", null);
        Assert.assertEquals("/api/v1/v3/api-docs", url);
    }

    // ---- Swagger2 scenarios ----

    @Test
    public void test_getOpenAPIURL_swagger2_noContextPath() {
        String url = ServiceUtils.getOpenAPIURL(discoverSwagger2(), "", null);
        Assert.assertEquals("/v2/api-docs?group=default", url);
    }

    @Test
    public void test_getOpenAPIURL_swagger2_withContextPath() {
        String url = ServiceUtils.getOpenAPIURL(discoverSwagger2(), "/uaa", null);
        Assert.assertEquals("/uaa/v2/api-docs?group=default", url);
    }

    @Test
    public void test_getOpenAPIURL_swagger2_contextPathWithoutLeadingSlash() {
        // issue #107 场景：swagger2 + context-path 无前导斜杠
        String url = ServiceUtils.getOpenAPIURL(discoverSwagger2(), "uaa", null);
        Assert.assertNotNull(url);
        Assert.assertTrue("URL must start with /", url.startsWith("/"));
        Assert.assertEquals("/uaa/v2/api-docs?group=default", url);
    }
}
