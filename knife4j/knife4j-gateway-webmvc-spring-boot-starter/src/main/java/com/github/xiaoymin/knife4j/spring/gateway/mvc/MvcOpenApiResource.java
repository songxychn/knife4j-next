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

import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.Getter;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

@Getter
final class MvcOpenApiResource implements Comparable<MvcOpenApiResource> {

    @JsonIgnore
    private final Integer order;
    @JsonIgnore
    private final String serviceName;
    private final String name;
    private final String url;
    private final String contextPath;
    private final String id;

    private MvcOpenApiResource(String name, String serviceName, String url, String contextPath, Integer order) {
        this.name = name;
        this.serviceName = serviceName;
        this.url = url;
        this.contextPath = MvcPathUtils.normalizeContextPath(contextPath);
        this.order = order == null ? 0 : order;
        this.id = Base64.getEncoder().encodeToString((name + url + this.contextPath).getBytes(StandardCharsets.UTF_8));
    }

    static MvcOpenApiResource manual(Knife4jGatewayMvcProperties.Router router) {
        return new MvcOpenApiResource(router.getName(), router.getServiceName(), router.getUrl(), router.getContextPath(), router.getOrder());
    }

    static MvcOpenApiResource discovered(String name, String serviceName, String url, String contextPath, Integer order) {
        return new MvcOpenApiResource(name, serviceName, url, contextPath, order);
    }

    MvcOpenApiResource withBasePath(String basePath) {
        return new MvcOpenApiResource(name, serviceName, MvcPathUtils.append(basePath, url),
                MvcPathUtils.append(basePath, contextPath), order);
    }

    @Override
    public int compareTo(MvcOpenApiResource other) {
        int orderComparison = order.compareTo(other.order);
        return orderComparison != 0 ? orderComparison : name.compareTo(other.name);
    }
}
