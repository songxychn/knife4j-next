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


package com.github.xiaoymin.knife4j.aggre.utils;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * 验证 {@link PathUtils#processContextPath(String)} 在各种 contextPath 入参下的行为。
 * <p>
 * 关键回归用例：当 contextPath 为 {@code null} 或空串时（cloud/eureka/nacos/polaris
 * 路由模式下开发者未配置 servicePath 即会出现），必须安全返回空串，不能抛出
 * {@link NullPointerException}，否则 {@code /v3/api-docs/swagger-config} 端点会
 * 返回 500，导致 React UI 无法加载文档（issue #421）。
 */
public class PathUtilsProcessContextPathTest {

    @Test
    public void test_NullContextPath_ReturnsEmpty() {
        // 修复 issue #421 之前，这里会抛 NullPointerException
        assertEquals("", PathUtils.processContextPath(null));
    }

    @Test
    public void test_EmptyContextPath_ReturnsEmpty() {
        assertEquals("", PathUtils.processContextPath(""));
    }

    @Test
    public void test_SlashContextPath_ReturnsEmpty() {
        assertEquals("", PathUtils.processContextPath("/"));
    }

    @Test
    public void test_NormalContextPath_KeptAsIs() {
        assertEquals("/api", PathUtils.processContextPath("/api"));
    }

    @Test
    public void test_TrailingSlashContextPath_Trimmed() {
        assertEquals("/api", PathUtils.processContextPath("/api/"));
    }
}
