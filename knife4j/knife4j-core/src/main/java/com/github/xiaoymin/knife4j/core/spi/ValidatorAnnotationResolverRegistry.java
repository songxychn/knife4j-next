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
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.ServiceLoader;

/**
 * Registry for {@link Knife4jValidatorAnnotationResolver} instances.
 *
 * <p>Resolvers are loaded via {@link ServiceLoader} from
 * {@code META-INF/services/com.github.xiaoymin.knife4j.core.spi.Knife4jValidatorAnnotationResolver}.
 * Additional resolvers can be registered programmatically (e.g. from Spring beans) via
 * {@link #register(Knife4jValidatorAnnotationResolver)}.
 *
 * <p>The built-in {@link BuiltinValidatorAnnotationResolver} is always present and runs last,
 * so custom resolvers registered first take priority.
 *
 * @since knife4j-next (issue #118)
 */
public final class ValidatorAnnotationResolverRegistry {

    private static final ValidatorAnnotationResolverRegistry INSTANCE =
            new ValidatorAnnotationResolverRegistry();

    private final List<Knife4jValidatorAnnotationResolver> resolvers = new ArrayList<>();

    private ValidatorAnnotationResolverRegistry() {
        // Load custom resolvers from ServiceLoader
        ServiceLoader<Knife4jValidatorAnnotationResolver> loader =
                ServiceLoader.load(Knife4jValidatorAnnotationResolver.class);
        for (Knife4jValidatorAnnotationResolver r : loader) {
            resolvers.add(r);
        }
        // Built-in resolver always last (lowest priority)
        resolvers.add(new BuiltinValidatorAnnotationResolver());
    }

    /**
     * Returns the singleton registry instance.
     */
    public static ValidatorAnnotationResolverRegistry getInstance() {
        return INSTANCE;
    }

    /**
     * Registers an additional resolver at the front of the chain (highest priority).
     * Intended for Spring bean registration.
     *
     * @param resolver the resolver to add
     */
    public void register(Knife4jValidatorAnnotationResolver resolver) {
        if (resolver != null) {
            resolvers.add(0, resolver);
        }
    }

    /**
     * Resolves the given annotation by iterating all registered resolvers.
     * Returns the first non-null, non-empty result, or an empty map if none match.
     *
     * @param annotation the annotation to resolve
     * @return schema property increments; never {@code null}
     */
    public Map<String, Object> resolve(Annotation annotation) {
        for (Knife4jValidatorAnnotationResolver resolver : resolvers) {
            Map<String, Object> result = resolver.resolve(annotation);
            if (result != null && !result.isEmpty()) {
                return result;
            }
        }
        return Collections.emptyMap();
    }

    /**
     * Returns an unmodifiable view of all registered resolvers (for testing).
     */
    public List<Knife4jValidatorAnnotationResolver> getResolvers() {
        return Collections.unmodifiableList(resolvers);
    }
}
