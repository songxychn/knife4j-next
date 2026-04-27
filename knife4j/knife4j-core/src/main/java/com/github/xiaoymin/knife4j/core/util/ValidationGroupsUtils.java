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


package com.github.xiaoymin.knife4j.core.util;

import java.lang.annotation.Annotation;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.*;

/**
 * Utility for resolving Bean Validation constraint groups on a model class.
 *
 * <p>Uses reflection throughout so there is no compile-time dependency on either
 * {@code javax.validation} or {@code jakarta.validation}. Works with whichever
 * validation API is present on the classpath at runtime.
 *
 * @since knife4j-next (issue #117)
 */
public final class ValidationGroupsUtils {

    /**
     * Constraint annotation simple names that indicate a field is required when present.
     */
    private static final Set<String> REQUIRED_CONSTRAINT_NAMES = new HashSet<>(Arrays.asList(
            "NotNull", "NotBlank", "NotEmpty"));

    private ValidationGroupsUtils() {
    }

    /**
     * Scans {@code modelClass} for fields annotated with constraint annotations
     * (e.g. {@code @NotNull}, {@code @NotBlank}, {@code @NotEmpty}) whose
     * {@code groups} attribute contains at least one of the supplied
     * {@code targetGroups}.
     *
     * <p>Returns a map of {@code groupSimpleName -> [fieldName, ...]} for every
     * target group that has at least one matching field. Groups with no matching
     * fields are omitted from the result.
     *
     * @param modelClass   the request-body class to inspect
     * @param targetGroups the validation groups declared on the operation
     * @return map of group simple name to required field names; never {@code null}
     */
    public static Map<String, List<String>> resolveRequiredFields(
                                                                  Class<?> modelClass, Class<?>[] targetGroups) {

        if (modelClass == null || targetGroups == null || targetGroups.length == 0) {
            return Collections.emptyMap();
        }

        // group simpleName -> ordered list of required field names
        Map<String, List<String>> result = new LinkedHashMap<>();
        for (Class<?> g : targetGroups) {
            result.put(g.getSimpleName(), new ArrayList<>());
        }

        // Walk the class hierarchy (stop at Object)
        Class<?> cursor = modelClass;
        while (cursor != null && cursor != Object.class) {
            for (Field field : cursor.getDeclaredFields()) {
                for (Annotation ann : field.getDeclaredAnnotations()) {
                    if (!isRequiredConstraint(ann)) {
                        continue;
                    }
                    Class<?>[] constraintGroups = getGroups(ann);
                    for (Class<?> targetGroup : targetGroups) {
                        if (constraintGroups.length == 0) {
                            // Default group — only matches if targetGroup is Default
                            if (isDefaultGroup(targetGroup)) {
                                result.get(targetGroup.getSimpleName()).add(field.getName());
                            }
                        } else {
                            for (Class<?> cg : constraintGroups) {
                                if (cg.equals(targetGroup)) {
                                    result.get(targetGroup.getSimpleName()).add(field.getName());
                                    break;
                                }
                            }
                        }
                    }
                }
            }
            cursor = cursor.getSuperclass();
        }

        // Remove groups with no required fields
        result.entrySet().removeIf(e -> e.getValue().isEmpty());
        return result;
    }

    // ---- private helpers ----

    private static boolean isRequiredConstraint(Annotation ann) {
        return REQUIRED_CONSTRAINT_NAMES.contains(ann.annotationType().getSimpleName());
    }

    /**
     * Reads the {@code groups()} attribute of a constraint annotation via reflection.
     * Returns an empty array if the attribute is absent or inaccessible.
     */
    private static Class<?>[] getGroups(Annotation ann) {
        try {
            Method groupsMethod = ann.annotationType().getMethod("groups");
            groupsMethod.setAccessible(true);
            Object value = groupsMethod.invoke(ann);
            if (value instanceof Class<?>[]) {
                return (Class<?>[]) value;
            }
        } catch (Exception ignored) {
            // annotation does not have groups() — treat as default group
        }
        return new Class<?>[0];
    }

    /**
     * Returns {@code true} if {@code group} is the Bean Validation Default group
     * (either {@code javax.validation.groups.Default} or
     * {@code jakarta.validation.groups.Default}).
     */
    private static boolean isDefaultGroup(Class<?> group) {
        String name = group.getName();
        return "javax.validation.groups.Default".equals(name)
                || "jakarta.validation.groups.Default".equals(name);
    }
}
