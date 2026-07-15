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


package com.github.xiaoymin.knife4j.spring.gateway.mvc;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.util.StringUtils;

import java.net.URI;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class MvcPathUtils {

    private static final Pattern DOC_HTML = Pattern.compile("(.*?)/doc\\.html", Pattern.CASE_INSENSITIVE);

    private MvcPathUtils() {
    }

    static String getDefaultContextPath(HttpServletRequest request) {
        String contextPath = request.getContextPath();
        if (StringUtils.hasText(contextPath)) {
            return contextPath;
        }
        String referer = request.getHeader("Referer");
        if (!StringUtils.hasText(referer)) {
            return "/";
        }
        try {
            Matcher matcher = DOC_HTML.matcher(URI.create(referer).getPath());
            return matcher.find() ? matcher.group(1) : "/";
        } catch (IllegalArgumentException ignored) {
            return "/";
        }
    }

    static String append(String first, String second) {
        String left = trim(first);
        String right = trim(second);
        if (left.isEmpty() && right.isEmpty()) {
            return "/";
        }
        if (left.isEmpty()) {
            return "/" + right;
        }
        if (right.isEmpty()) {
            return "/" + left;
        }
        return "/" + left + "/" + right;
    }

    static String normalizeContextPath(String path) {
        String normalized = trim(path);
        return normalized.isEmpty() ? "" : "/" + normalized;
    }

    static String routePrefix(String pattern) {
        return normalizeContextPath(pattern == null ? "" : pattern.replace("**", ""));
    }

    private static String trim(String path) {
        if (!StringUtils.hasText(path) || "/".equals(path)) {
            return "";
        }
        String result = path.trim().replaceAll("/+", "/");
        result = result.replaceFirst("^/+", "");
        return result.replaceFirst("/+$", "");
    }
}
