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
import com.github.xiaoymin.knife4j.core.conf.ExtensionsConstants;
import io.swagger.v3.oas.models.Operation;
import org.junit.Assert;
import org.junit.Test;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.method.HandlerMethod;

import java.lang.annotation.*;
import java.util.List;
import java.util.Map;

/**
 * Unit tests for the {@code x-validation-groups} extension emitted by
 * {@link Knife4jJakartaOperationCustomizer}.
 */
public class Knife4jValidationGroupsExtensionTest {

    // ---- stub group markers ----

    interface Create {
    }
    interface Update {
    }

    // ---- stub constraint annotations (simple names match real BV constraints) ----

    @Retention(RetentionPolicy.RUNTIME)
    @Target(ElementType.FIELD)
    @interface NotNull {

        Class<?>[] groups() default {};
    }

    @Retention(RetentionPolicy.RUNTIME)
    @Target(ElementType.FIELD)
    @interface NotBlank {

        Class<?>[] groups() default {};
    }

    // ---- fixture DTO ----

    static class UserFormRequest {

        @NotNull(groups = Update.class)
        Long id;

        @NotBlank(groups = {Create.class, Update.class})
        String name;

        @NotBlank(groups = Create.class)
        String email;

        String phone;
    }

    // ---- fixture controller ----

    @RestController
    static class DemoController {

        @ApiOperationSupport(order = 1, validationGroups = {Create.class})
        public void create(@RequestBody UserFormRequest req) {
        }

        @ApiOperationSupport(order = 2, validationGroups = {Update.class})
        public void update(@RequestBody UserFormRequest req) {
        }

        @ApiOperationSupport(order = 3)
        public void noGroups(@RequestBody UserFormRequest req) {
        }

        public void noAnnotation(@RequestBody UserFormRequest req) {
        }
    }

    // ---- helpers ----

    private HandlerMethod handlerMethod(String methodName) throws Exception {
        DemoController bean = new DemoController();
        java.lang.reflect.Method m = DemoController.class.getMethod(methodName, UserFormRequest.class);
        return new HandlerMethod(bean, m);
    }

    private Knife4jJakartaOperationCustomizer customizer() {
        return new Knife4jJakartaOperationCustomizer();
    }

    // ---- tests ----

    @Test
    public void createGroupExtensionContainsNameAndEmail() throws Exception {
        Operation op = new Operation().operationId("create");
        customizer().customize(op, handlerMethod("create"));

        Assert.assertNotNull(op.getExtensions());
        @SuppressWarnings("unchecked")
        Map<String, List<String>> groups =
                (Map<String, List<String>>) op.getExtensions().get(ExtensionsConstants.EXTENSION_VALIDATION_GROUPS);
        Assert.assertNotNull(groups);
        Assert.assertTrue(groups.containsKey("Create"));
        Assert.assertTrue(groups.get("Create").contains("name"));
        Assert.assertTrue(groups.get("Create").contains("email"));
        Assert.assertFalse(groups.get("Create").contains("id"));
    }

    @Test
    public void updateGroupExtensionContainsIdAndName() throws Exception {
        Operation op = new Operation().operationId("update");
        customizer().customize(op, handlerMethod("update"));

        @SuppressWarnings("unchecked")
        Map<String, List<String>> groups =
                (Map<String, List<String>>) op.getExtensions().get(ExtensionsConstants.EXTENSION_VALIDATION_GROUPS);
        Assert.assertNotNull(groups);
        Assert.assertTrue(groups.get("Update").contains("id"));
        Assert.assertTrue(groups.get("Update").contains("name"));
        Assert.assertFalse(groups.get("Update").contains("email"));
    }

    @Test
    public void noValidationGroupsAttributeProducesNoExtension() throws Exception {
        Operation op = new Operation().operationId("noGroups");
        customizer().customize(op, handlerMethod("noGroups"));

        if (op.getExtensions() != null) {
            Assert.assertFalse(op.getExtensions().containsKey(ExtensionsConstants.EXTENSION_VALIDATION_GROUPS));
        }
    }

    @Test
    public void noAnnotationProducesNoValidationGroupsExtension() throws Exception {
        Operation op = new Operation().operationId("noAnnotation");
        customizer().customize(op, handlerMethod("noAnnotation"));

        if (op.getExtensions() != null) {
            Assert.assertFalse(op.getExtensions().containsKey(ExtensionsConstants.EXTENSION_VALIDATION_GROUPS));
        }
    }
}
