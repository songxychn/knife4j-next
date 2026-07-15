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

import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.regex.Pattern;

final class MvcBasicAuthFilter implements Filter {

    private static final String SESSION_ATTRIBUTE = "KNIFE4J_GATEWAY_MVC_BASIC_AUTH";
    private final Knife4jGatewayMvcProperties.Basic basic;
    private final List<Pattern> protectedUrls = new ArrayList<>();

    MvcBasicAuthFilter(Knife4jGatewayMvcProperties.Basic basic) {
        this.basic = basic;
        protectedUrls.add(Pattern.compile(".*/doc\\.html.*", Pattern.CASE_INSENSITIVE));
        protectedUrls.add(Pattern.compile(".*/v2/api-docs.*", Pattern.CASE_INSENSITIVE));
        protectedUrls.add(Pattern.compile(".*/v3/api-docs.*", Pattern.CASE_INSENSITIVE));
        protectedUrls.add(Pattern.compile(".*/swagger-ui.*", Pattern.CASE_INSENSITIVE));
        for (String include : basic.getInclude()) {
            protectedUrls.add(Pattern.compile(include, Pattern.CASE_INSENSITIVE));
        }
    }

    @Override
    public void doFilter(ServletRequest servletRequest, ServletResponse servletResponse, FilterChain chain) throws IOException, ServletException {
        HttpServletRequest request = (HttpServletRequest) servletRequest;
        HttpServletResponse response = (HttpServletResponse) servletResponse;
        if (!matches(request.getRequestURI()) || authenticated(request)) {
            chain.doFilter(request, response);
            return;
        }
        unauthorized(response);
    }

    private boolean authenticated(HttpServletRequest request) {
        if (request.getSession().getAttribute(SESSION_ATTRIBUTE) != null) {
            return true;
        }
        String authorization = request.getHeader("Authorization");
        if (authorization == null || !authorization.startsWith("Basic ")) {
            return false;
        }
        try {
            String decoded = new String(Base64.getDecoder().decode(authorization.substring(6)), StandardCharsets.UTF_8);
            String[] credentials = decoded.split(":", 2);
            if (credentials.length != 2 || !basic.getUsername().equals(credentials[0])
                    || !basic.getPassword().equals(credentials[1])) {
                return false;
            }
            request.getSession().setAttribute(SESSION_ATTRIBUTE, basic.getUsername());
            return true;
        } catch (IllegalArgumentException ignored) {
            return false;
        }
    }

    private boolean matches(String requestUri) {
        String normalized = requestUri.replaceAll("/+", "/");
        int semicolon = normalized.indexOf(';');
        if (semicolon >= 0) {
            normalized = normalized.substring(0, semicolon);
        }
        for (Pattern protectedUrl : protectedUrls) {
            if (protectedUrl.matcher(normalized).matches()) {
                return true;
            }
        }
        return false;
    }

    private void unauthorized(HttpServletResponse response) throws IOException {
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setHeader("WWW-Authenticate", "Basic realm=\"Knife4j Gateway\"");
        response.getWriter().write("Unauthorized");
    }
}
