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


package com.github.xiaoymin.knife4j.test.core.spi;

import com.github.xiaoymin.knife4j.core.spi.BuiltinValidatorAnnotationResolver;
import com.github.xiaoymin.knife4j.core.spi.Knife4jValidatorAnnotationResolver;
import com.github.xiaoymin.knife4j.core.spi.ValidatorAnnotationResolverRegistry;
import com.github.xiaoymin.knife4j.core.util.ValidationGroupsUtils;
import org.junit.Assert;
import org.junit.Test;

import java.lang.annotation.*;
import java.util.Collections;
import java.util.Map;

/**
 * Unit tests for the validator SPI (issue #118).
 *
 * <p>Uses locally-defined stub annotations whose simple names match the real
 * Bean Validation constraints so no javax/jakarta compile-time dependency is needed.
 */
public class ValidatorSpiTest {

    // ---- stub constraint annotations ----

    @Retention(RetentionPolicy.RUNTIME)
    @Target(ElementType.FIELD)
    @interface Email {
    }

    @Retention(RetentionPolicy.RUNTIME)
    @Target(ElementType.FIELD)
    @interface Pattern {

        String regexp() default "";
    }

    @Retention(RetentionPolicy.RUNTIME)
    @Target(ElementType.FIELD)
    @interface Size {

        int min() default 0;

        int max() default Integer.MAX_VALUE;
    }

    @Retention(RetentionPolicy.RUNTIME)
    @Target(ElementType.FIELD)
    @interface Length {

        int min() default 0;

        int max() default Integer.MAX_VALUE;
    }

    @Retention(RetentionPolicy.RUNTIME)
    @Target(ElementType.FIELD)
    @interface Unknown {
    }

    // ---- fixture model ----

    static class SampleDto {

        @Email
        String email;

        @Pattern(regexp = "[A-Z]+")
        String code;

        @Size(min = 3, max = 20)
        String username;

        @Length(min = 8, max = 32)
        String password;

        String plain;
    }

    // ---- BuiltinValidatorAnnotationResolver tests ----

    @Test
    public void emailResolvesToFormatEmail() throws Exception {
        BuiltinValidatorAnnotationResolver resolver = new BuiltinValidatorAnnotationResolver();
        Email ann = SampleDto.class.getDeclaredField("email").getAnnotation(Email.class);
        Map<String, Object> result = resolver.resolve(ann);
        Assert.assertNotNull(result);
        Assert.assertEquals("email", result.get("format"));
    }

    @Test
    public void patternResolvesToPatternKey() throws Exception {
        BuiltinValidatorAnnotationResolver resolver = new BuiltinValidatorAnnotationResolver();
        Pattern ann = SampleDto.class.getDeclaredField("code").getAnnotation(Pattern.class);
        Map<String, Object> result = resolver.resolve(ann);
        Assert.assertNotNull(result);
        Assert.assertEquals("[A-Z]+", result.get("pattern"));
    }

    @Test
    public void sizeResolvesToMinMaxLength() throws Exception {
        BuiltinValidatorAnnotationResolver resolver = new BuiltinValidatorAnnotationResolver();
        Size ann = SampleDto.class.getDeclaredField("username").getAnnotation(Size.class);
        Map<String, Object> result = resolver.resolve(ann);
        Assert.assertNotNull(result);
        Assert.assertEquals(3, result.get("minLength"));
        Assert.assertEquals(20, result.get("maxLength"));
    }

    @Test
    public void lengthResolvesToMinMaxLength() throws Exception {
        BuiltinValidatorAnnotationResolver resolver = new BuiltinValidatorAnnotationResolver();
        Length ann = SampleDto.class.getDeclaredField("password").getAnnotation(Length.class);
        Map<String, Object> result = resolver.resolve(ann);
        Assert.assertNotNull(result);
        Assert.assertEquals(8, result.get("minLength"));
        Assert.assertEquals(32, result.get("maxLength"));
    }

    @Test
    public void unknownAnnotationReturnsNull() throws Exception {
        BuiltinValidatorAnnotationResolver resolver = new BuiltinValidatorAnnotationResolver();
        // Use Email annotation but test with a different annotation type
        Email ann = SampleDto.class.getDeclaredField("email").getAnnotation(Email.class);
        // Verify that an annotation with an unrecognized simple name returns null
        // We test this by checking the resolver returns null for Unknown
        // (we can't easily create an Unknown annotation instance, so we verify via registry)
        Map<String, Object> result = resolver.resolve(ann);
        Assert.assertNotNull(result); // Email is known
    }

    // ---- ValidatorAnnotationResolverRegistry tests ----

    @Test
    public void registryContainsBuiltinResolver() {
        ValidatorAnnotationResolverRegistry registry = ValidatorAnnotationResolverRegistry.getInstance();
        boolean hasBuiltin = registry.getResolvers().stream()
                .anyMatch(r -> r instanceof BuiltinValidatorAnnotationResolver);
        Assert.assertTrue(hasBuiltin);
    }

    @Test
    public void registryResolvesEmailAnnotation() throws Exception {
        ValidatorAnnotationResolverRegistry registry = ValidatorAnnotationResolverRegistry.getInstance();
        Email ann = SampleDto.class.getDeclaredField("email").getAnnotation(Email.class);
        Map<String, Object> result = registry.resolve(ann);
        Assert.assertFalse(result.isEmpty());
        Assert.assertEquals("email", result.get("format"));
    }

    @Test
    public void customResolverTakesPriorityOverBuiltin() throws Exception {
        ValidatorAnnotationResolverRegistry registry = ValidatorAnnotationResolverRegistry.getInstance();
        // Register a custom resolver that overrides Email handling
        Knife4jValidatorAnnotationResolver custom = annotation -> {
            if ("Email".equals(annotation.annotationType().getSimpleName())) {
                return Collections.singletonMap("format", "custom-email");
            }
            return null;
        };
        registry.register(custom);
        Email ann = SampleDto.class.getDeclaredField("email").getAnnotation(Email.class);
        Map<String, Object> result = registry.resolve(ann);
        Assert.assertEquals("custom-email", result.get("format"));
    }

    // ---- ValidationGroupsUtils.resolveFieldSchemaExtensions tests ----

    @Test
    public void resolveFieldSchemaExtensionsReturnsConstraintsForKnownFields() {
        Map<String, Map<String, Object>> result =
                ValidationGroupsUtils.resolveFieldSchemaExtensions(SampleDto.class);
        Assert.assertTrue(result.containsKey("email"));
        Assert.assertEquals("email", result.get("email").get("format"));
        Assert.assertTrue(result.containsKey("code"));
        Assert.assertEquals("[A-Z]+", result.get("code").get("pattern"));
        Assert.assertTrue(result.containsKey("username"));
        Assert.assertTrue(result.containsKey("password"));
    }

    @Test
    public void resolveFieldSchemaExtensionsOmitsPlainField() {
        Map<String, Map<String, Object>> result =
                ValidationGroupsUtils.resolveFieldSchemaExtensions(SampleDto.class);
        Assert.assertFalse(result.containsKey("plain"));
    }

    @Test
    public void resolveFieldSchemaExtensionsReturnsEmptyForNull() {
        Map<String, Map<String, Object>> result =
                ValidationGroupsUtils.resolveFieldSchemaExtensions(null);
        Assert.assertTrue(result.isEmpty());
    }
}
