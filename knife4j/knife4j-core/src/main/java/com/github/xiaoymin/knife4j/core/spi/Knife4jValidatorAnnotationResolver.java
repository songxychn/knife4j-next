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
import java.util.Map;

/**
 * SPI interface for resolving Bean Validation (or custom) constraint annotations
 * into OpenAPI schema property increments.
 *
 * <p>Implementations are discovered via {@link java.util.ServiceLoader} or registered
 * as Spring beans. When knife4j processes a field annotation it iterates all registered
 * resolvers; the first non-null result wins.
 *
 * <p>Built-in resolvers handle {@code @Email}, {@code @Pattern}, and {@code @Length}
 * from both {@code javax.validation} and {@code jakarta.validation} namespaces.
 *
 * <p>To add a custom resolver:
 * <ol>
 *   <li>Implement this interface.</li>
 *   <li>Register via {@code META-INF/services/com.github.xiaoymin.knife4j.core.spi.Knife4jValidatorAnnotationResolver}
 *       (ServiceLoader) <em>or</em> expose as a Spring {@code @Bean}.</li>
 * </ol>
 *
 * @since knife4j-next (issue #118)
 */
public interface Knife4jValidatorAnnotationResolver {

    /**
     * Resolves the given annotation into a map of OpenAPI schema property increments.
     *
     * <p>Return {@code null} (or an empty map) if this resolver does not handle the
     * annotation — the next resolver in the chain will be tried.
     *
     * <p>Example return values:
     * <ul>
     *   <li>{@code @Email} → {@code {"format": "email"}}</li>
     *   <li>{@code @Pattern(regexp="[A-Z]+")} → {@code {"pattern": "[A-Z]+"}}</li>
     *   <li>{@code @Length(min=1, max=50)} → {@code {"minLength": 1, "maxLength": 50}}</li>
     * </ul>
     *
     * @param annotation the constraint annotation found on a model field
     * @return map of schema property name → value to merge, or {@code null} if not handled
     */
    Map<String, Object> resolve(Annotation annotation);
}
