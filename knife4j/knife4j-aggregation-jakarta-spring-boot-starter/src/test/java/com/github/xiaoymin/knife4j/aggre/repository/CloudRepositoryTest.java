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


package com.github.xiaoymin.knife4j.aggre.repository;

import cn.hutool.core.lang.Assert;
import cn.hutool.core.util.StrUtil;
import com.github.xiaoymin.knife4j.aggre.cloud.CloudRoute;
import com.github.xiaoymin.knife4j.aggre.core.RouteDispatcher;
import com.github.xiaoymin.knife4j.aggre.core.pojo.SwaggerRoute;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * @since
 * @author <a href="xiaoymin@foxmail.com">xiaoymin@foxmail.com</a>
 * 2022/8/10 21:05
 */
public class CloudRepositoryTest {

    @Test
    public void test_Start() {
        String uri = "http://www.baidu.com";
        Assert.isFalse(StrUtil.startWith("http", uri));
        Assert.isTrue(StrUtil.startWith(uri, "http"));
    }

    /**
     * 验证 cloud 路由构造 SwaggerRoute 时，location 被重写为
     * {@code /swagger-instance?group=<pkId>}，并保留原始 location 用于后续远程代理。
     * 该行为修复了 React UI 在 cloud 路由模式下页面为空的问题。
     */
    @Test
    public void test_CloudRoute_LocationRewritten() {
        CloudRoute cloudRoute = new CloudRoute();
        cloudRoute.setName("user-service");
        cloudRoute.setUri("http://127.0.0.1:8080");
        cloudRoute.setLocation("/v3/api-docs");
        cloudRoute.setSwaggerVersion("3.0");

        SwaggerRoute swaggerRoute = new SwaggerRoute(cloudRoute);

        String pkId = cloudRoute.pkId();
        String expectedLocation = RouteDispatcher.OPENAPI_GROUP_INSTANCE_ENDPOINT + "?group=" + pkId;
        assertEquals(expectedLocation, swaggerRoute.getLocation(),
                "cloud 模式下 location 应该重写为 /swagger-instance?group=<pkId>");
        assertEquals("/v3/api-docs", swaggerRoute.getOriginalLocation(),
                "originalLocation 应该保留 cloud 路由原始 location");
        assertEquals("http://127.0.0.1:8080", swaggerRoute.getUri(),
                "uri 应该保留 cloud 路由的远程地址");
    }
}
