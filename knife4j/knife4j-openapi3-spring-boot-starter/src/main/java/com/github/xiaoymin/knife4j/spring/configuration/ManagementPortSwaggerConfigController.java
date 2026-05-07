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

import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springdoc.core.SpringDocConfigProperties;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Workaround for upstream issue #803: when {@code springdoc.use-management-port=true} springdoc
 * registers its endpoints (including {@code /v3/api-docs/swagger-config}) only on the management
 * (actuator) port. The knife4j UI is served from the main port and fetches swagger-config from the
 * same origin, so it gets a 404.
 *
 * <p>This controller registers {@code /v3/api-docs/swagger-config} on the main port when
 * {@code springdoc.use-management-port=true} is detected, returning a minimal but correct
 * swagger-config response built from {@link SpringDocConfigProperties}.
 *
 * @since 5.0.0
 * @author knife4j-next
 */
@Slf4j
@AllArgsConstructor
@RestController
@Configuration
@ConditionalOnProperty(name = "springdoc.use-management-port", havingValue = "true")
public class ManagementPortSwaggerConfigController {

    private final SpringDocConfigProperties springDocConfigProperties;

    /**
     * Serves {@code /v3/api-docs/swagger-config} on the main port when
     * {@code springdoc.use-management-port=true}.
     *
     * <p>The response mirrors the format that springdoc's own {@code SwaggerConfigResource}
     * produces, so the knife4j UI can discover the available API groups.
     */
    @GetMapping(value = "/v3/api-docs/swagger-config", produces = MediaType.APPLICATION_JSON_VALUE)
    public Map<String, Object> swaggerConfig() {
        log.debug("Serving /v3/api-docs/swagger-config on main port (use-management-port=true workaround, issue #318)");

        String apiDocsPath = resolveApiDocsPath();
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("configUrl", "/v3/api-docs/swagger-config");

        List<SpringDocConfigProperties.GroupConfig> groupConfigs = springDocConfigProperties.getGroupConfigs();
        if (groupConfigs != null && !groupConfigs.isEmpty()) {
            List<Map<String, String>> urls = new ArrayList<>();
            for (SpringDocConfigProperties.GroupConfig group : groupConfigs) {
                Map<String, String> entry = new LinkedHashMap<>();
                entry.put("url", apiDocsPath + "/" + group.getGroup());
                entry.put("name", group.getGroup());
                urls.add(entry);
            }
            response.put("urls", urls);
        } else {
            List<Map<String, String>> urls = new ArrayList<>();
            Map<String, String> entry = new LinkedHashMap<>();
            entry.put("url", apiDocsPath);
            entry.put("name", "default");
            urls.add(entry);
            response.put("urls", urls);
        }

        return response;
    }

    private String resolveApiDocsPath() {
        if (springDocConfigProperties.getApiDocs() != null
                && springDocConfigProperties.getApiDocs().getPath() != null
                && !springDocConfigProperties.getApiDocs().getPath().isEmpty()) {
            return springDocConfigProperties.getApiDocs().getPath();
        }
        return "/v3/api-docs";
    }
}
