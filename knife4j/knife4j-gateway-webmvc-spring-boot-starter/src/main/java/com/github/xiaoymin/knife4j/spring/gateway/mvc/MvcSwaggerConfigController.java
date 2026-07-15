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
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import static org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE;

@RestController
final class MvcSwaggerConfigController {

    private final Knife4jGatewayMvcProperties properties;
    private final ObjectProvider<MvcGatewayDiscoveryService> discoveryService;

    MvcSwaggerConfigController(Knife4jGatewayMvcProperties properties,
                               ObjectProvider<MvcGatewayDiscoveryService> discoveryService) {
        this.properties = properties;
        this.discoveryService = discoveryService;
    }

    @GetMapping("/v3/api-docs/swagger-config")
    ResponseEntity<MvcSwaggerConfigResponse> swaggerConfig(HttpServletRequest request) {
        String basePath = MvcPathUtils.getDefaultContextPath(request);
        MvcSwaggerConfigResponse response = new MvcSwaggerConfigResponse();
        response.setConfigUrl(MvcPathUtils.append(basePath, "/v3/api-docs/swagger-config"));
        response.setOauth2RedirectUrl(properties.getDiscover().getOas3().getOauth2RedirectUrl());
        response.setValidatorUrl(properties.getDiscover().getOas3().getValidatorUrl());
        response.setTagsSorter(properties.getTagsSorter().name());
        response.setOperationsSorter(properties.getOperationsSorter().name());
        response.setSetting(properties.getSetting());
        response.setUrls(resources(basePath));
        return ResponseEntity.ok(response);
    }

    private List<MvcOpenApiResource> resources(String basePath) {
        if (properties.getStrategy() == Knife4jGatewayMvcProperties.Strategy.MANUAL) {
            List<MvcOpenApiResource> resources = new ArrayList<>();
            for (Knife4jGatewayMvcProperties.Router route : properties.getRoutes()) {
                resources.add(MvcOpenApiResource.manual(route).withBasePath(basePath));
            }
            Collections.sort(resources);
            return resources;
        }
        MvcGatewayDiscoveryService service = discoveryService.getIfAvailable();
        if (service == null || !service.isAvailable()) {
            throw new ResponseStatusException(SERVICE_UNAVAILABLE,
                    "DISCOVER requires a configured Spring Cloud DiscoveryClient");
        }
        return service.resources(basePath);
    }
}
