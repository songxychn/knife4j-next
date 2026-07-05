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

import com.github.xiaoymin.knife4j.core.conf.ExtensionsConstants;
import io.swagger.v3.oas.models.Operation;
import org.junit.Assert;
import org.junit.Test;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.method.HandlerMethod;

import java.lang.annotation.*;
import java.util.List;
import java.util.Map;

public class Knife4jValidationGroupsExtensionTest {

    interface Create {
    }
    interface Update {
    }

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

    static class UserFormRequest {

        @NotNull(groups = Update.class)
        Long id;

        @NotBlank(groups = {Create.class, Update.class})
        String name;

        @NotBlank(groups = Create.class)
        String email;
    }

    @RestController
    static class DemoController {

        public void create(@RequestBody @Validated(Create.class) UserFormRequest req) {
        }

        public void update(@RequestBody @Validated(Update.class) UserFormRequest req) {
        }
    }

    private HandlerMethod handlerMethod(String methodName) throws Exception {
        DemoController bean = new DemoController();
        java.lang.reflect.Method method = DemoController.class.getMethod(methodName, UserFormRequest.class);
        return new HandlerMethod(bean, method);
    }

    @Test
    public void validatedRequestBodyProducesCreateGroupExtension() throws Exception {
        Operation op = new Operation().operationId("create");
        new Knife4jOperationCustomizer().customize(op, handlerMethod("create"));

        @SuppressWarnings("unchecked")
        Map<String, List<String>> groups =
                (Map<String, List<String>>) op.getExtensions().get(ExtensionsConstants.EXTENSION_VALIDATION_GROUPS);
        Assert.assertNotNull(groups);
        Assert.assertTrue(groups.get("Create").contains("name"));
        Assert.assertTrue(groups.get("Create").contains("email"));
        Assert.assertFalse(groups.get("Create").contains("id"));
    }

    @Test
    public void validatedRequestBodyProducesUpdateGroupExtension() throws Exception {
        Operation op = new Operation().operationId("update");
        new Knife4jOperationCustomizer().customize(op, handlerMethod("update"));

        @SuppressWarnings("unchecked")
        Map<String, List<String>> groups =
                (Map<String, List<String>>) op.getExtensions().get(ExtensionsConstants.EXTENSION_VALIDATION_GROUPS);
        Assert.assertNotNull(groups);
        Assert.assertTrue(groups.get("Update").contains("id"));
        Assert.assertTrue(groups.get("Update").contains("name"));
        Assert.assertFalse(groups.get("Update").contains("email"));
    }
}
