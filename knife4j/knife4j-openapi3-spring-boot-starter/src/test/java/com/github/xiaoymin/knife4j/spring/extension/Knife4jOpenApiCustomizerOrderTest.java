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

import com.github.xiaoymin.knife4j.annotations.ApiSupport;
import com.github.xiaoymin.knife4j.core.conf.ExtensionsConstants;
import com.github.xiaoymin.knife4j.spring.configuration.Knife4jProperties;
import io.swagger.v3.oas.annotations.tags.Tag;
import io.swagger.v3.oas.models.OpenAPI;
import org.junit.Assert;
import org.junit.Test;
import org.springdoc.core.SpringDocConfigProperties;
import org.springframework.web.bind.annotation.RestController;

import java.util.Collections;
import java.util.HashSet;

/**
 * Unit tests for Knife4jOpenApiCustomizer x-order extension (non-jakarta variant).
 */
public class Knife4jOpenApiCustomizerOrderTest {

    // ---- fixture controllers ----

    @RestController
    @Tag(name = "Alpha")
    @ApiSupport(order = 10)
    static class AlphaController {
    }

    @RestController
    @Tag(name = "Beta")
    @ApiSupport(order = 20)
    static class BetaController {
    }

    @RestController
    @Tag(name = "NoOrder")
    static class NoOrderController {
    }

    // ---- helpers ----

    private Knife4jOpenApiCustomizer buildCustomizer(String... packages) {
        Knife4jProperties props = new Knife4jProperties();
        props.setEnable(true);
        SpringDocConfigProperties docProps = new SpringDocConfigProperties();
        if (packages.length > 0) {
            SpringDocConfigProperties.GroupConfig group = new SpringDocConfigProperties.GroupConfig();
            group.setPackagesToScan(java.util.Arrays.asList(packages));
            docProps.setGroupConfigs(new HashSet<>(Collections.singletonList(group)));
        }
        return new Knife4jOpenApiCustomizer(props, docProps);
    }

    private OpenAPI buildOpenApi(String... tagNames) {
        OpenAPI openApi = new OpenAPI();
        for (String name : tagNames) {
            openApi.addTagsItem(new io.swagger.v3.oas.models.tags.Tag().name(name));
        }
        return openApi;
    }

    // ---- tests ----

    @Test
    public void tagOrderAppliedWhenPackageScanConfigured() {
        String pkg = AlphaController.class.getPackage().getName();
        Knife4jOpenApiCustomizer customizer = buildCustomizer(pkg);

        OpenAPI openApi = buildOpenApi("Alpha", "Beta");
        customizer.customise(openApi);

        io.swagger.v3.oas.models.tags.Tag alpha = openApi.getTags().stream()
                .filter(t -> "Alpha".equals(t.getName())).findFirst().orElseThrow(AssertionError::new);
        io.swagger.v3.oas.models.tags.Tag beta = openApi.getTags().stream()
                .filter(t -> "Beta".equals(t.getName())).findFirst().orElseThrow(AssertionError::new);

        Assert.assertEquals(10, alpha.getExtensions().get(ExtensionsConstants.EXTENSION_ORDER));
        Assert.assertEquals(20, beta.getExtensions().get(ExtensionsConstants.EXTENSION_ORDER));
    }

    @Test
    public void tagWithoutApiSupportGetsNoOrder() {
        String pkg = NoOrderController.class.getPackage().getName();
        Knife4jOpenApiCustomizer customizer = buildCustomizer(pkg);

        OpenAPI openApi = buildOpenApi("NoOrder");
        customizer.customise(openApi);

        io.swagger.v3.oas.models.tags.Tag tag = openApi.getTags().get(0);
        Assert.assertNull(tag.getExtensions());
    }

    @Test
    public void noPackageScanDoesNotThrow() {
        Knife4jOpenApiCustomizer customizer = buildCustomizer();
        OpenAPI openApi = buildOpenApi("Alpha");
        customizer.customise(openApi);
        Assert.assertNull(openApi.getTags().get(0).getExtensions());
    }
}
