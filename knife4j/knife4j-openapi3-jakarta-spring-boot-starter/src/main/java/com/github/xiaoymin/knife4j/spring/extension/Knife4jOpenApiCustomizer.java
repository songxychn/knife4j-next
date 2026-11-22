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


package com.github.xiaoymin.knife4j.spring.extension;

import com.github.xiaoymin.knife4j.spring.configuration.Knife4jProperties;
import io.swagger.v3.oas.models.OpenAPI;
import lombok.AllArgsConstructor;
import org.springdoc.core.customizers.GlobalOpenApiCustomizer;
import org.springdoc.core.properties.SpringDocConfigProperties;
import org.springframework.util.CollectionUtils;

import java.util.LinkedHashSet;
import java.util.Set;

/**
 * 增强扩展属性支持
 * @since 4.1.0
 * @author <a href="xiaoymin@foxmail.com">xiaoymin@foxmail.com</a>
 * 2022/12/11 22:40
 */
@AllArgsConstructor
public class Knife4jOpenApiCustomizer implements GlobalOpenApiCustomizer {

    final Knife4jProperties knife4jProperties;
    final SpringDocConfigProperties properties;
    @Override
    public void customise(OpenAPI openApi) {
        OpenApiExtensions.apply(openApi, knife4jProperties, this::collectPackagesToScan);
    }

    private Set<String> collectPackagesToScan() {
        Set<String> packagesToScan = new LinkedHashSet<>();
        if (properties == null) {
            return packagesToScan;
        }
        if (!CollectionUtils.isEmpty(properties.getPackagesToScan())) {
            packagesToScan.addAll(properties.getPackagesToScan());
        }
        if (!CollectionUtils.isEmpty(properties.getGroupConfigs())) {
            properties.getGroupConfigs().stream()
                    .map(SpringDocConfigProperties.GroupConfig::getPackagesToScan)
                    .filter(toScan -> !CollectionUtils.isEmpty(toScan))
                    .forEach(packagesToScan::addAll);
        }
        return packagesToScan;
    }
}
