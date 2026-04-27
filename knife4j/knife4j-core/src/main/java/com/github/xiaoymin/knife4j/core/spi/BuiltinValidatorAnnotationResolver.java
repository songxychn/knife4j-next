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


package com.github.xiaoymin.knife4j.core.spi;

import java.lang.annotation.Annotation;
import java.lang.reflect.Method;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Built-in {@link Knife4jValidatorAnnotationResolver} that handles the most common
 * Bean Validation constraints:
 * <ul>
 *   <li>{@code @Email} (javax &amp; jakarta) → {@code {"format": "email"}}</li>
 *   <li>{@code @Pattern} (javax &amp; jakarta) → {@code {"pattern": "<regexp>"}}</li>
 *   <li>{@code @Length} (Hibernate Validator, javax &amp; jakarta) →
 *       {@code {"minLength": n, "maxLength": m}}</li>
 *   <li>{@code @Size} (javax &amp; jakarta) →
 *       {@code {"minLength": n, "maxLength": m}} (for string fields)</li>
 * </ul>
 *
 * <p>Uses reflection so there is no compile-time dependency on any validation API.
 *
 * @since knife4j-next (issue #118)
 */
public class BuiltinValidatorAnnotationResolver implements Knife4jValidatorAnnotationResolver {

    @Override
    public Map<String, Object> resolve(Annotation annotation) {
        String simpleName = annotation.annotationType().getSimpleName();
        switch (simpleName) {
            case "Email":
                return Collections.singletonMap("format", "email");
            case "Pattern":
                return resolvePattern(annotation);
            case "Length":
            case "Size":
                return resolveMinMax(annotation);
            default:
                return null;
        }
    }

    private Map<String, Object> resolvePattern(Annotation annotation) {
        String regexp = (String) invokeAttribute(annotation, "regexp");
        if (regexp == null || regexp.isEmpty()) {
            return null;
        }
        return Collections.singletonMap("pattern", regexp);
    }

    private Map<String, Object> resolveMinMax(Annotation annotation) {
        Integer min = (Integer) invokeAttribute(annotation, "min");
        Integer max = (Integer) invokeAttribute(annotation, "max");
        if (min == null && max == null) {
            return null;
        }
        Map<String, Object> result = new LinkedHashMap<>();
        if (min != null && min > 0) {
            result.put("minLength", min);
        }
        if (max != null && max < Integer.MAX_VALUE) {
            result.put("maxLength", max);
        }
        return result.isEmpty() ? null : result;
    }

    private Object invokeAttribute(Annotation annotation, String attributeName) {
        try {
            Method m = annotation.annotationType().getMethod(attributeName);
            return m.invoke(annotation);
        } catch (Exception ignored) {
            return null;
        }
    }
}
