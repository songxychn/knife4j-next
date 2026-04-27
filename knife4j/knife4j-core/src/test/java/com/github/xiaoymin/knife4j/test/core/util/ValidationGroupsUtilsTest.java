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


package com.github.xiaoymin.knife4j.test.core.util;

import com.github.xiaoymin.knife4j.core.util.ValidationGroupsUtils;
import org.junit.Assert;
import org.junit.Test;

import java.lang.annotation.*;
import java.util.List;
import java.util.Map;

/**
 * Unit tests for {@link ValidationGroupsUtils}.
 *
 * <p>Uses locally-defined stub annotations whose simple names match the real
 * Bean Validation constraints ({@code NotNull}, {@code NotBlank}, {@code NotEmpty})
 * so no javax/jakarta compile-time dependency is needed in knife4j-core.
 */
public class ValidationGroupsUtilsTest {

    // ---- stub group markers ----

    interface Create {
    }
    interface Update {
    }
    interface NoMatchGroup {
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

    @Retention(RetentionPolicy.RUNTIME)
    @Target(ElementType.FIELD)
    @interface NotEmpty {

        Class<?>[] groups() default {};
    }

    // ---- fixture model ----

    static class UserFormRequest {

        @NotNull(groups = Update.class)
        Long id;

        @NotBlank(groups = {Create.class, Update.class})
        String name;

        @NotBlank(groups = Create.class)
        String email;

        String phone; // no constraint
    }

    // ---- tests ----

    @Test
    public void createGroupReturnsNameAndEmail() {
        Map<String, List<String>> result = ValidationGroupsUtils.resolveRequiredFields(
                UserFormRequest.class, new Class<?>[]{Create.class});

        Assert.assertTrue(result.containsKey("Create"));
        List<String> fields = result.get("Create");
        Assert.assertTrue(fields.contains("name"));
        Assert.assertTrue(fields.contains("email"));
        Assert.assertFalse(fields.contains("id"));
        Assert.assertFalse(fields.contains("phone"));
    }

    @Test
    public void updateGroupReturnsIdAndName() {
        Map<String, List<String>> result = ValidationGroupsUtils.resolveRequiredFields(
                UserFormRequest.class, new Class<?>[]{Update.class});

        Assert.assertTrue(result.containsKey("Update"));
        List<String> fields = result.get("Update");
        Assert.assertTrue(fields.contains("id"));
        Assert.assertTrue(fields.contains("name"));
        Assert.assertFalse(fields.contains("email"));
    }

    @Test
    public void bothGroupsReturnedWhenBothRequested() {
        Map<String, List<String>> result = ValidationGroupsUtils.resolveRequiredFields(
                UserFormRequest.class, new Class<?>[]{Create.class, Update.class});

        Assert.assertEquals(2, result.size());
        Assert.assertTrue(result.get("Create").contains("email"));
        Assert.assertTrue(result.get("Update").contains("id"));
    }

    @Test
    public void emptyGroupsArrayReturnsEmptyMap() {
        Map<String, List<String>> result = ValidationGroupsUtils.resolveRequiredFields(
                UserFormRequest.class, new Class<?>[0]);
        Assert.assertTrue(result.isEmpty());
    }

    @Test
    public void nullModelClassReturnsEmptyMap() {
        Map<String, List<String>> result = ValidationGroupsUtils.resolveRequiredFields(
                null, new Class<?>[]{Create.class});
        Assert.assertTrue(result.isEmpty());
    }

    @Test
    public void groupWithNoMatchingFieldsOmittedFromResult() {
        Map<String, List<String>> result = ValidationGroupsUtils.resolveRequiredFields(
                UserFormRequest.class, new Class<?>[]{NoMatchGroup.class});
        Assert.assertTrue(result.isEmpty());
    }

    @Test
    public void phoneFieldNeverAppearsInAnyGroup() {
        Map<String, List<String>> result = ValidationGroupsUtils.resolveRequiredFields(
                UserFormRequest.class, new Class<?>[]{Create.class, Update.class});
        for (List<String> fields : result.values()) {
            Assert.assertFalse(fields.contains("phone"));
        }
    }
}
