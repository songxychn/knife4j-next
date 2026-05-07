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


package com.baizhukui.knife4j.demo.openapi2;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * Provides a {@code /v3/api-docs/swagger-config} endpoint so that the
 * knife4j-vue3 UI (which always requests this path when {@code springdoc=true})
 * can discover the Swagger 2 spec served by springfox at {@code /v2/api-docs}.
 *
 * <p>The response shape mirrors what springdoc-openapi returns for its
 * {@code swagger-config} endpoint, so the Vue3 UI can parse it without
 * any frontend changes.
 */
@RestController
public class SwaggerConfigController {

    @GetMapping("/v3/api-docs/swagger-config")
    public Map<String, Object> swaggerConfig() {
        return Map.of(
                "configUrl", "/v3/api-docs/swagger-config",
                "urls", List.of(
                        Map.of(
                                "url", "/v2/api-docs",
                                "name", "knife4j-next OAS2 Demo")));
    }
}
