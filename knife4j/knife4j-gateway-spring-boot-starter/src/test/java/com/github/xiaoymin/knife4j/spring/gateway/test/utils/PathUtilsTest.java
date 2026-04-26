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

import com.github.xiaoymin.knife4j.spring.gateway.utils.PathUtils;
import lombok.extern.slf4j.Slf4j;
import org.junit.Assert;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.runners.JUnit4;

import java.net.URI;

/**
 * @author <a href="xiaoymin@foxmail.com">xiaoymin@foxmail.com</a>
 * 2023/3/8 08:57
 * @since knife4j
 */
@Slf4j
@RunWith(JUnit4.class)
public class PathUtilsTest {

    @Test
    public void test_contextPath() {
        log.info(PathUtils.processContextPath("/"));
        log.info(PathUtils.processContextPath("/abc"));
        log.info(PathUtils.processContextPath("/abc/"));

    }

    @Test
    public void test_ref() {
        String ref = "http://localhost:15013/s/doc.html";
        URI uri = URI.create(ref);
        log.info("path:{}", PathUtils.getContextPath(ref));
    }

    @Test
    public void test_append() {
        String path = "/abc";
        String appendPath = PathUtils.append(path);
        Assert.assertNotNull(appendPath);
        log.info("path:{}", appendPath);
        Assert.assertEquals(PathUtils.append(null), "/");
        Assert.assertEquals(PathUtils.append("//abc"), "/abc");
    }

    @Test
    public void test_processContextPath_leadingSlash() {
        // 无前导斜杠的 contextPath 应被修正，防止 host 拼接缺少 /
        Assert.assertEquals("/api", PathUtils.processContextPath("api"));
        Assert.assertEquals("/api", PathUtils.processContextPath("api/"));
        // 已有前导斜杠的不变
        Assert.assertEquals("/api", PathUtils.processContextPath("/api"));
        Assert.assertEquals("/api", PathUtils.processContextPath("/api/"));
        // 根路径返回空字符串
        Assert.assertEquals("", PathUtils.processContextPath("/"));
        // 空字符串不变
        Assert.assertEquals("", PathUtils.processContextPath(""));
    }

    @Test
    public void test_processContextPath_multiSegment() {
        // 多段 context-path，无前导斜杠
        Assert.assertEquals("/api/v1", PathUtils.processContextPath("api/v1"));
        Assert.assertEquals("/api/v1", PathUtils.processContextPath("api/v1/"));
        // 多段 context-path，有前导斜杠
        Assert.assertEquals("/api/v1", PathUtils.processContextPath("/api/v1"));
        Assert.assertEquals("/api/v1", PathUtils.processContextPath("/api/v1/"));
        // uaa 场景（issue #107）
        Assert.assertEquals("/uaa", PathUtils.processContextPath("uaa"));
        Assert.assertEquals("/uaa", PathUtils.processContextPath("/uaa"));
        Assert.assertEquals("/uaa", PathUtils.processContextPath("uaa/"));
        Assert.assertEquals("/uaa", PathUtils.processContextPath("/uaa/"));
    }

    @Test
    public void test_append_withContextPath() {
        // context-path 拼接 api-docs 路径，确保不缺 /
        Assert.assertEquals("/uaa/v3/api-docs", PathUtils.append("/uaa", "/v3/api-docs"));
        Assert.assertEquals("/api/v1/v3/api-docs", PathUtils.append("/api/v1", "/v3/api-docs"));
        // 无 context-path 时直接返回 api-docs 路径
        Assert.assertEquals("/v3/api-docs", PathUtils.append("", "/v3/api-docs"));
        Assert.assertEquals("/v3/api-docs", PathUtils.append("/v3/api-docs"));
    }

    @Test
    public void test_append1() {
        String path = "//abc";
        String appendPath = PathUtils.append(path, "//v2/api-dcos");
        log.info("path:{}", appendPath);
        log.info("path1:{}", PathUtils.append("/bbb", "user-service", "/v2/api-dcos"));
        log.info("path1:{}", PathUtils.append(null, "user-service", "/v2/api-dcos"));
        log.info("path1:{}", PathUtils.append("user-service", "user-service", "/v2/api-dcos"));
    }
}
