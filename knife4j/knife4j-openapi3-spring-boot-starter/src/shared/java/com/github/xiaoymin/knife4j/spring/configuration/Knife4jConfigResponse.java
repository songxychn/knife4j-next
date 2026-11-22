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


package com.github.xiaoymin.knife4j.spring.configuration;

import com.github.xiaoymin.knife4j.core.conf.GlobalConstants;

import java.util.LinkedHashMap;
import java.util.Map;

final class Knife4jConfigResponse {

    private static final String DEFAULT_API_DOCS_PATH = "v3/api-docs";

    private Knife4jConfigResponse() {
    }

    static Map<String, Object> response(String path) {
        String apiDocsPath = normalizeApiDocsPath(path);
        Map<String, String> openapi = new LinkedHashMap<>();
        openapi.put(GlobalConstants.EXTENSION_API_DOCS_URL, apiDocsPath);
        openapi.put(GlobalConstants.EXTENSION_SWAGGER_CONFIG_URL, apiDocsPath + "/swagger-config");

        Map<String, Object> config = new LinkedHashMap<>();
        config.put(GlobalConstants.EXTENSION_SCHEMA_VERSION, GlobalConstants.KNIFE4J_CONFIG_SCHEMA_VERSION);
        config.put(GlobalConstants.EXTENSION_OPENAPI, openapi);
        return config;
    }

    private static String normalizeApiDocsPath(String path) {
        if (path == null || path.trim().isEmpty()) {
            return DEFAULT_API_DOCS_PATH;
        }
        String normalized = path.trim();
        while (normalized.startsWith("/")) {
            normalized = normalized.substring(1);
        }
        while (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return normalized.isEmpty() ? DEFAULT_API_DOCS_PATH : normalized;
    }
}
