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

import io.swagger.v3.oas.models.media.ArraySchema;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.parameters.Parameter;
import org.springdoc.core.customizers.ParameterCustomizer;
import org.springframework.core.MethodParameter;
import org.springframework.web.bind.annotation.RequestParam;

import java.lang.reflect.ParameterizedType;
import java.lang.reflect.Type;
import java.util.Collection;

/**
 * Fixes springdoc's handling of {@code List<T>} / {@code Set<T>} parameters annotated with
 * {@code @RequestParam} (upstream xiaoymin/knife4j#732).
 *
 * <p>When springdoc resolves a collection-typed {@code @RequestParam}, it may emit a schema
 * without {@code explode:true} and without a proper {@code items} sub-schema, causing doc.html
 * to display the wrong type and default value. This customizer corrects those fields:
 * <ul>
 *   <li>Sets {@code explode = true} so the UI sends each element as a separate query parameter.</li>
 *   <li>Ensures the schema is {@code type:array} with an {@code items} sub-schema whose
 *       {@code type} matches the collection's element type (defaults to {@code string}).</li>
 * </ul>
 *
 * @since knife4j 5.0.0
 */
public class Knife4jCollectionParameterCustomizer implements ParameterCustomizer {

    @Override
    public Parameter customize(Parameter parameter, MethodParameter methodParameter) {
        if (parameter == null || methodParameter == null) {
            return parameter;
        }
        // Only apply to @RequestParam parameters
        if (methodParameter.getParameterAnnotation(RequestParam.class) == null) {
            return parameter;
        }
        // Check if the Java type is a Collection (List, Set, etc.)
        Class<?> paramType = methodParameter.getParameterType();
        if (!Collection.class.isAssignableFrom(paramType)) {
            return parameter;
        }

        // Ensure explode=true so each element is sent as a separate query param
        parameter.setExplode(Boolean.TRUE);

        // Resolve element type from generic signature (e.g. List<String> -> String)
        String itemType = resolveElementType(methodParameter.getGenericParameterType());

        Schema<?> schema = parameter.getSchema();
        if (schema == null) {
            schema = new ArraySchema();
            parameter.setSchema(schema);
        }

        // Ensure the schema is typed as array
        if (!"array".equals(schema.getType())) {
            schema.setType("array");
        }

        // Ensure items sub-schema is present with the correct type
        if (schema instanceof ArraySchema) {
            ArraySchema arraySchema = (ArraySchema) schema;
            if (arraySchema.getItems() == null) {
                Schema<?> items = new Schema<>();
                items.setType(itemType);
                arraySchema.setItems(items);
            } else if (arraySchema.getItems().getType() == null) {
                arraySchema.getItems().setType(itemType);
            }
        } else {
            // schema is not an ArraySchema instance but has type=array -- set items if missing
            if (schema.getItems() == null) {
                Schema<?> items = new Schema<>();
                items.setType(itemType);
                schema.setItems(items);
            }
        }

        return parameter;
    }

    /**
     * Resolves the OAS primitive type name for the first type argument of a generic collection.
     * Falls back to {@code "string"} for unknown or raw types.
     */
    private String resolveElementType(Type genericType) {
        if (genericType instanceof ParameterizedType) {
            Type[] typeArgs = ((ParameterizedType) genericType).getActualTypeArguments();
            if (typeArgs.length > 0 && typeArgs[0] instanceof Class) {
                return javaTypeToOasType((Class<?>) typeArgs[0]);
            }
        }
        return "string";
    }

    private String javaTypeToOasType(Class<?> clazz) {
        if (clazz == Integer.class || clazz == int.class
                || clazz == Long.class || clazz == long.class
                || clazz == Short.class || clazz == short.class
                || clazz == Byte.class || clazz == byte.class) {
            return "integer";
        }
        if (clazz == Double.class || clazz == double.class
                || clazz == Float.class || clazz == float.class) {
            return "number";
        }
        if (clazz == Boolean.class || clazz == boolean.class) {
            return "boolean";
        }
        return "string";
    }
}
