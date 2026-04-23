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


package com.github.xiaoymin.knife4j.test.core.filter;

import com.github.xiaoymin.knife4j.extend.filter.BasicFilter;
import org.junit.Assert;
import org.junit.Test;

/**
 * Security regression test for issue #886:
 * Semicolon path parameters must NOT bypass basic auth matching.
 *
 * <p>A request like {@code /v2/api-docs;jsessionid=abc} should still be
 * treated as a protected path and trigger authentication, not silently
 * pass through because the semicolon suffix confuses the matcher.</p>
 */
public class BasicFilterSemicolonBypassTest {
    
    /**
     * Concrete subclass that exposes {@code match()} for unit testing.
     */
    static class TestableBasicFilter extends BasicFilter {
        
        public boolean testMatch(String uri) {
            return match(uri);
        }
    }
    
    private final TestableBasicFilter filter = new TestableBasicFilter();
    
    // -----------------------------------------------------------------------
    // Normal paths must still be matched (regression guard)
    // -----------------------------------------------------------------------
    
    @Test
    public void normalV2ApiDocsShouldMatch() {
        Assert.assertTrue(filter.testMatch("/v2/api-docs"));
    }
    
    @Test
    public void normalV3ApiDocsShouldMatch() {
        Assert.assertTrue(filter.testMatch("/v3/api-docs"));
    }
    
    @Test
    public void normalDocHtmlShouldMatch() {
        Assert.assertTrue(filter.testMatch("/doc.html"));
    }
    
    @Test
    public void normalSwaggerResourcesShouldMatch() {
        Assert.assertTrue(filter.testMatch("/swagger-resources"));
    }
    
    // -----------------------------------------------------------------------
    // Semicolon bypass attempts must ALSO be matched (security fix #886)
    // -----------------------------------------------------------------------
    
    @Test
    public void semicolonSuffixOnV2ApiDocsShouldMatch() {
        // CVE-style bypass: /v2/api-docs;jsessionid=abc
        Assert.assertTrue(
                "Semicolon suffix must not bypass basic auth for /v2/api-docs",
                filter.testMatch("/v2/api-docs;jsessionid=abc"));
    }
    
    @Test
    public void semicolonSuffixOnV3ApiDocsShouldMatch() {
        Assert.assertTrue(
                "Semicolon suffix must not bypass basic auth for /v3/api-docs",
                filter.testMatch("/v3/api-docs;foo=bar"));
    }
    
    @Test
    public void semicolonSuffixOnDocHtmlShouldMatch() {
        Assert.assertTrue(
                "Semicolon suffix must not bypass basic auth for /doc.html",
                filter.testMatch("/doc.html;x=1"));
    }
    
    @Test
    public void semicolonSuffixOnSwaggerResourcesShouldMatch() {
        Assert.assertTrue(
                "Semicolon suffix must not bypass basic auth for /swagger-resources",
                filter.testMatch("/swagger-resources;bypass=true"));
    }
    
    @Test
    public void multipleSemicolonsShouldMatch() {
        Assert.assertTrue(
                "Multiple semicolons must not bypass basic auth",
                filter.testMatch("/v2/api-docs;a=1;b=2"));
    }
    
    // -----------------------------------------------------------------------
    // Unrelated paths must NOT match
    // -----------------------------------------------------------------------
    
    @Test
    public void unrelatedPathShouldNotMatch() {
        Assert.assertFalse(filter.testMatch("/api/users"));
    }
    
    @Test
    public void unrelatedPathWithSemicolonShouldNotMatch() {
        Assert.assertFalse(filter.testMatch("/api/users;jsessionid=abc"));
    }
}
