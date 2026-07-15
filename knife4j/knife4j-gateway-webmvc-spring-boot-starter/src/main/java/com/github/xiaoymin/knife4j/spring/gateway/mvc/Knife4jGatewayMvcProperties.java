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

import com.github.xiaoymin.knife4j.core.extend.OpenApiExtendSetting;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * MVC Gateway aggregation properties. The public {@code knife4j.gateway.*}
 * keys intentionally match the WebFlux Gateway starter where their meanings
 * overlap.
 */
@Getter
@Setter
@ConfigurationProperties(prefix = "knife4j.gateway")
public class Knife4jGatewayMvcProperties {

    private boolean enabled;
    private Strategy strategy = Strategy.MANUAL;
    private Sorter tagsSorter = Sorter.alpha;
    private Sorter operationsSorter = Sorter.alpha;
    private OpenApiExtendSetting setting = new OpenApiExtendSetting();
    private Basic basic = new Basic();
    private final Discover discover = new Discover();
    private final List<Router> routes = new ArrayList<>();

    public enum Strategy {
        DISCOVER,
        MANUAL
    }

    public enum Sorter {
        alpha,
        order
    }

    public enum OpenApiVersion {
        Swagger2,
        OpenAPI3
    }

    @Getter
    @Setter
    public static class Basic {

        private boolean enable;
        private String username = "admin";
        private String password = "123321";
        private List<String> include = new ArrayList<>();
    }

    @Getter
    @Setter
    public static class Discover {

        private Boolean enabled = Boolean.FALSE;
        private Set<String> excludedServices = new HashSet<>();
        private OpenApiVersion version = OpenApiVersion.OpenAPI3;
        private final OpenApiV3 oas3 = new OpenApiV3();
        private final OpenApiV2 swagger2 = new OpenApiV2();
        private final Map<String, ServiceConfigInfo> serviceConfig = new HashMap<>();

        public String getApiDocsPath() {
            return version == OpenApiVersion.Swagger2 ? swagger2.getUrl() : oas3.getUrl();
        }
    }

    @Getter
    @Setter
    public static class ServiceConfigInfo {

        private Integer order = 0;
        private String groupName;
        private List<String> groupNames = new ArrayList<>();
        private String contextPath;
    }

    @Getter
    @Setter
    public static class Router {

        private String name;
        private String serviceName;
        private String url = "/v2/api-docs?group=default";
        private String contextPath = "/";
        private Integer order = 0;
    }

    @Getter
    @Setter
    public static class OpenApiV2 {

        private String url = "/v2/api-docs?group=default";
    }

    @Getter
    @Setter
    public static class OpenApiV3 {

        private String url = "/v3/api-docs";
        private String oauth2RedirectUrl = "";
        private String validatorUrl = "";
    }
}
