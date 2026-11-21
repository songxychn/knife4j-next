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


package com.github.xiaoymin.knife4j.spring.gateway.filter;

import org.junit.Assert;
import org.junit.Test;

public class AbstractBasicAuthFilterSemicolonTest {

    private static class TestFilter extends AbstractBasicAuthFilter {

        boolean testMatch(String uri) {
            return match(uri);
        }
    }

    private final TestFilter filter = new TestFilter();

    @Test
    public void middleAndTrailingSemicolonsShouldNotBypassGatewayBasicAuth() {
        Assert.assertTrue(filter.testMatch("/v3/api-docs;jsessionid=abc"));
        Assert.assertTrue(filter.testMatch("/v3;x=1/api-docs"));
        Assert.assertTrue(filter.testMatch("/;x=1/doc.html"));
        Assert.assertTrue(filter.testMatch("//;a=1//swagger-resources;b=2"));
        Assert.assertFalse(filter.testMatch("/api;x=1/users;y=2"));
    }
}
