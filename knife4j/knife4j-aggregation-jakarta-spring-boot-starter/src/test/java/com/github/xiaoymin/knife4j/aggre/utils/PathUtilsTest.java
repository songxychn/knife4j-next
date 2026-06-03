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

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * 验证 {@link PathUtils#processContextPath(String)} 的健壮性。
 *
 * <p>回归覆盖 issue #421：Cloud 路由未配置 {@code servicePath} 时，
 * {@link com.github.xiaoymin.knife4j.aggre.core.pojo.SwaggerRoute#getServicePath()} 为 {@code null}，
 * 此前会触发 {@link NullPointerException}，最终 {@code /v3/api-docs/swagger-config} 返回 500。
 */
class PathUtilsTest {

    @Test
    void processContextPath_shouldReturnEmptyForNull() {
        // issue #421 复现：null contextPath 不应抛 NPE
        Assertions.assertEquals("", PathUtils.processContextPath(null));
    }

    @Test
    void processContextPath_shouldReturnEmptyForRoot() {
        Assertions.assertEquals("", PathUtils.processContextPath("/"));
    }

    @Test
    void processContextPath_shouldStripTrailingSlash() {
        Assertions.assertEquals("/api", PathUtils.processContextPath("/api"));
        Assertions.assertEquals("/api", PathUtils.processContextPath("/api/"));
        Assertions.assertEquals("/api/v1", PathUtils.processContextPath("/api/v1"));
        Assertions.assertEquals("/api/v1", PathUtils.processContextPath("/api/v1/"));
    }

    @Test
    void processContextPath_shouldPreserveEmptyString() {
        Assertions.assertEquals("", PathUtils.processContextPath(""));
    }
}
