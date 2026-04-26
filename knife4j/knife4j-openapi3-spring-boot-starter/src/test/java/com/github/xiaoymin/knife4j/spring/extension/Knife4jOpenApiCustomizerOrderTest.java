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

import com.github.xiaoymin.knife4j.annotations.ApiOperationSupport;
import com.github.xiaoymin.knife4j.annotations.ApiSupport;
import com.github.xiaoymin.knife4j.core.conf.ExtensionsConstants;
import com.github.xiaoymin.knife4j.spring.configuration.Knife4jProperties;
import com.github.xiaoymin.knife4j.spring.configuration.Knife4jSetting;
import io.swagger.v3.oas.annotations.tags.Tag;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.PathItem;
import io.swagger.v3.oas.models.Paths;
import org.junit.Assert;
import org.junit.Test;
import org.springdoc.core.SpringDocConfigProperties;
import org.springframework.web.bind.annotation.RestController;

import java.util.Arrays;

/**
 * Unit tests for Knife4jOpenApiCustomizer x-order extension (non-jakarta variant).
 */
public class Knife4jOpenApiCustomizerOrderTest {

    // ---- fixture controllers ----

    @RestController
    @Tag(name = "Alpha")
    @ApiSupport(order = 10)
    static class AlphaController {

        @ApiOperationSupport(order = 1)
        public void listAlpha() {
        }
    }

    @RestController
    @Tag(name = "Beta")
    @ApiSupport(order = 20)
    static class BetaController {

        @ApiOperationSupport(order = 2)
        public void listBeta() {
        }
    }

    @RestController
    @Tag(name = "NoOrder")
    static class NoOrderController {
    } // no @ApiSupport

    // ---- helpers ----

    private Knife4jOpenApiCustomizer buildCustomizer(String... packages) {
        Knife4jProperties props = new Knife4jProperties();
        props.setEnable(true);
        Knife4jSetting setting = new Knife4jSetting();
        if (packages.length > 0) {
            setting.setApiOrderPackageScan(Arrays.asList(packages));
        }
        props.setSetting(setting);
        SpringDocConfigProperties docProps = new SpringDocConfigProperties();
        return new Knife4jOpenApiCustomizer(props, docProps, null);
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
    public void noPackageScanAndNoMappingDoesNotThrow() {
        Knife4jOpenApiCustomizer customizer = buildCustomizer();
        OpenAPI openApi = buildOpenApi("Alpha");
        customizer.customise(openApi);
        Assert.assertNull(openApi.getTags().get(0).getExtensions());
    }

    @Test
    public void operationOrderApplied() {
        String pkg = AlphaController.class.getPackage().getName();
        Knife4jOpenApiCustomizer customizer = buildCustomizer(pkg);

        OpenAPI openApi = buildOpenApi("Alpha");
        Paths paths = new Paths();
        Operation op = new Operation().operationId("listAlpha");
        PathItem pathItem = new PathItem().get(op);
        paths.addPathItem("/alpha", pathItem);
        openApi.setPaths(paths);

        customizer.customise(openApi);

        Assert.assertEquals(1, op.getExtensions().get(ExtensionsConstants.EXTENSION_ORDER));
    }

    @Test
    public void operationWithoutSupportAnnotationGetsNoOrder() {
        String pkg = AlphaController.class.getPackage().getName();
        Knife4jOpenApiCustomizer customizer = buildCustomizer(pkg);

        OpenAPI openApi = buildOpenApi("Alpha");
        Paths paths = new Paths();
        Operation op = new Operation().operationId("unknownMethod");
        PathItem pathItem = new PathItem().get(op);
        paths.addPathItem("/unknown", pathItem);
        openApi.setPaths(paths);

        customizer.customise(openApi);

        Assert.assertNull(op.getExtensions());
    }
}
