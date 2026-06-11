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

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.media.Schema;
import org.springdoc.core.customizers.GlobalOpenApiCustomizer;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.core.MethodParameter;
import org.springframework.http.HttpEntity;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.mvc.method.RequestMappingInfoHandlerMapping;

import java.beans.Introspector;
import java.lang.annotation.Annotation;
import java.lang.reflect.Field;
import java.lang.reflect.GenericArrayType;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.lang.reflect.ParameterizedType;
import java.lang.reflect.Type;
import java.lang.reflect.TypeVariable;
import java.lang.reflect.WildcardType;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CompletableFuture;

/**
 * Keeps Kotlin boolean properties such as {@code val isEnabled: Boolean} aligned with the
 * field name that Jackson 3 exposes at runtime.
 */
@SuppressWarnings({"rawtypes", "unchecked"})
public class Knife4jKotlinIsPrefixOpenApiCustomizer implements GlobalOpenApiCustomizer {

    private static final String KOTLIN_METADATA_ANNOTATION = "kotlin.Metadata";

    private static final String JACKSON2_JSON_GETTER_ANNOTATION = "com.fasterxml.jackson.annotation.JsonGetter";

    private static final String JACKSON2_JSON_PROPERTY_ANNOTATION = "com.fasterxml.jackson.annotation.JsonProperty";

    private static final String JACKSON3_JSON_GETTER_ANNOTATION = "tools.jackson.annotation.JsonGetter";

    private static final String JACKSON3_JSON_PROPERTY_ANNOTATION = "tools.jackson.annotation.JsonProperty";

    private final ObjectProvider<RequestMappingInfoHandlerMapping> handlerMappings;

    public Knife4jKotlinIsPrefixOpenApiCustomizer(ObjectProvider<RequestMappingInfoHandlerMapping> handlerMappings) {
        this.handlerMappings = handlerMappings;
    }

    @Override
    public void customise(OpenAPI openApi) {
        if (openApi == null || openApi.getComponents() == null || openApi.getComponents().getSchemas() == null) {
            return;
        }
        Map<String, Schema> schemas = openApi.getComponents().getSchemas();
        Map<String, Map<String, String>> renamesBySchema = collectKotlinIsPrefixRenames();
        if (renamesBySchema.isEmpty()) {
            return;
        }
        renamesBySchema.forEach((schemaName, propertyRenames) -> {
            Schema schema = schemas.get(schemaName);
            if (schema != null) {
                renameSchemaProperties(schema, propertyRenames);
            }
        });
    }

    private Map<String, Map<String, String>> collectKotlinIsPrefixRenames() {
        Map<String, Map<String, String>> renamesBySchema = new LinkedHashMap<>();
        handlerMappings.orderedStream()
                .flatMap(handlerMapping -> handlerMapping.getHandlerMethods().values().stream())
                .forEach(handlerMethod -> collectHandlerMethodRenames(handlerMethod, renamesBySchema));
        return renamesBySchema;
    }

    private void collectHandlerMethodRenames(HandlerMethod handlerMethod,
                                             Map<String, Map<String, String>> renamesBySchema) {
        Set<Type> visited = new HashSet<>();
        for (MethodParameter parameter : handlerMethod.getMethodParameters()) {
            if (parameter.hasParameterAnnotation(RequestBody.class)) {
                collectTypeRenames(parameter.getGenericParameterType(), renamesBySchema, visited);
            }
        }
        collectTypeRenames(handlerMethod.getReturnType().getGenericParameterType(), renamesBySchema, visited);
    }

    private void collectTypeRenames(Type type, Map<String, Map<String, String>> renamesBySchema, Set<Type> visited) {
        if (type == null || !visited.add(type)) {
            return;
        }
        if (type instanceof Class) {
            Class<?> rawClass = (Class<?>) type;
            if (rawClass.isArray()) {
                collectTypeRenames(rawClass.getComponentType(), renamesBySchema, visited);
                return;
            }
            collectClassRenames(rawClass, renamesBySchema);
            return;
        }
        if (type instanceof ParameterizedType) {
            ParameterizedType parameterizedType = (ParameterizedType) type;
            Type rawType = parameterizedType.getRawType();
            if (rawType instanceof Class) {
                Class<?> rawClass = (Class<?>) rawType;
                if (!isContainerOrWrapper(rawClass)) {
                    collectClassRenames(rawClass, renamesBySchema);
                }
            }
            for (Type argument : parameterizedType.getActualTypeArguments()) {
                collectTypeRenames(argument, renamesBySchema, visited);
            }
            return;
        }
        if (type instanceof GenericArrayType) {
            collectTypeRenames(((GenericArrayType) type).getGenericComponentType(), renamesBySchema, visited);
            return;
        }
        if (type instanceof WildcardType) {
            WildcardType wildcardType = (WildcardType) type;
            for (Type upperBound : wildcardType.getUpperBounds()) {
                collectTypeRenames(upperBound, renamesBySchema, visited);
            }
            return;
        }
        if (type instanceof TypeVariable) {
            TypeVariable<?> typeVariable = (TypeVariable<?>) type;
            for (Type bound : typeVariable.getBounds()) {
                collectTypeRenames(bound, renamesBySchema, visited);
            }
        }
    }

    private void collectClassRenames(Class<?> rawClass, Map<String, Map<String, String>> renamesBySchema) {
        if (!isKotlinClass(rawClass)) {
            return;
        }
        Map<String, String> propertyRenames = collectPropertyRenames(rawClass);
        if (propertyRenames.isEmpty()) {
            return;
        }
        renamesBySchema
                .computeIfAbsent(schemaName(rawClass), ignored -> new LinkedHashMap<>())
                .putAll(propertyRenames);
    }

    private Map<String, String> collectPropertyRenames(Class<?> rawClass) {
        Map<String, String> propertyRenames = new LinkedHashMap<>();
        Class<?> currentClass = rawClass;
        while (currentClass != null && currentClass != Object.class) {
            for (Field field : currentClass.getDeclaredFields()) {
                if (isKotlinIsPrefixBooleanField(field) && !hasExplicitJsonPropertyName(rawClass, field)) {
                    String fieldName = field.getName();
                    String javaBeansName = Introspector.decapitalize(fieldName.substring(2));
                    if (!fieldName.equals(javaBeansName)) {
                        propertyRenames.put(javaBeansName, fieldName);
                    }
                }
            }
            currentClass = currentClass.getSuperclass();
        }
        return propertyRenames;
    }

    private void renameSchemaProperties(Schema schema, Map<String, String> propertyRenames) {
        Map<String, Schema> properties = schema.getProperties();
        if (properties == null || properties.isEmpty()) {
            return;
        }
        Map<String, Schema> renamedProperties = new LinkedHashMap<>();
        boolean changed = false;
        for (Map.Entry<String, Schema> entry : properties.entrySet()) {
            String renamed = propertyRenames.get(entry.getKey());
            if (renamed != null && !properties.containsKey(renamed)) {
                renamedProperties.put(renamed, entry.getValue());
                changed = true;
            } else {
                renamedProperties.put(entry.getKey(), entry.getValue());
            }
        }
        if (!changed) {
            return;
        }
        schema.setProperties(renamedProperties);
        renameRequiredProperties(schema, propertyRenames);
    }

    private void renameRequiredProperties(Schema schema, Map<String, String> propertyRenames) {
        List<String> required = schema.getRequired();
        if (required == null || required.isEmpty()) {
            return;
        }
        List<String> renamedRequired = new ArrayList<>(required.size());
        boolean changed = false;
        for (String item : required) {
            String renamed = propertyRenames.get(item);
            if (renamed == null) {
                renamedRequired.add(item);
            } else {
                renamedRequired.add(renamed);
                changed = true;
            }
        }
        if (changed) {
            schema.setRequired(renamedRequired);
        }
    }

    private boolean isKotlinIsPrefixBooleanField(Field field) {
        int modifiers = field.getModifiers();
        if (Modifier.isStatic(modifiers)) {
            return false;
        }
        String name = field.getName();
        if (name.length() <= 2 || !name.startsWith("is") || !Character.isUpperCase(name.charAt(2))) {
            return false;
        }
        Class<?> fieldType = field.getType();
        return fieldType == boolean.class || fieldType == Boolean.class;
    }

    private boolean hasExplicitJsonPropertyName(Class<?> rawClass, Field field) {
        if (hasExplicitJsonPropertyName(field.getAnnotations())) {
            return true;
        }
        String fieldName = field.getName();
        String capitalizedFieldName = Character.toUpperCase(fieldName.charAt(0)) + fieldName.substring(1);
        for (Method method : rawClass.getDeclaredMethods()) {
            if (Modifier.isStatic(method.getModifiers()) || method.getParameterCount() != 0) {
                continue;
            }
            String methodName = method.getName();
            if ((methodName.equals(fieldName) || methodName.equals("get" + capitalizedFieldName))
                    && hasExplicitJsonPropertyName(method.getAnnotations())) {
                return true;
            }
        }
        return false;
    }

    private boolean hasExplicitJsonPropertyName(Annotation[] annotations) {
        for (Annotation annotation : annotations) {
            String annotationName = annotation.annotationType().getName();
            if ((JACKSON2_JSON_PROPERTY_ANNOTATION.equals(annotationName)
                    || JACKSON2_JSON_GETTER_ANNOTATION.equals(annotationName)
                    || JACKSON3_JSON_PROPERTY_ANNOTATION.equals(annotationName)
                    || JACKSON3_JSON_GETTER_ANNOTATION.equals(annotationName))
                    && hasNonBlankValue(annotation)) {
                return true;
            }
        }
        return false;
    }

    private boolean hasNonBlankValue(Annotation annotation) {
        try {
            Method valueMethod = annotation.annotationType().getMethod("value");
            Object value = valueMethod.invoke(annotation);
            return value instanceof String && !((String) value).trim().isEmpty();
        } catch (ReflectiveOperationException e) {
            return false;
        }
    }

    private boolean isKotlinClass(Class<?> rawClass) {
        for (Annotation annotation : rawClass.getAnnotations()) {
            if (KOTLIN_METADATA_ANNOTATION.equals(annotation.annotationType().getName())) {
                return true;
            }
        }
        return false;
    }

    private String schemaName(Class<?> rawClass) {
        io.swagger.v3.oas.annotations.media.Schema schema =
                rawClass.getAnnotation(io.swagger.v3.oas.annotations.media.Schema.class);
        if (schema != null && schema.name() != null && !schema.name().trim().isEmpty()) {
            return schema.name().trim();
        }
        return rawClass.getSimpleName();
    }

    private boolean isContainerOrWrapper(Class<?> rawClass) {
        return Collection.class.isAssignableFrom(rawClass)
                || Map.class.isAssignableFrom(rawClass)
                || Optional.class.isAssignableFrom(rawClass)
                || HttpEntity.class.isAssignableFrom(rawClass)
                || CompletableFuture.class.isAssignableFrom(rawClass)
                || "reactor.core.publisher.Mono".equals(rawClass.getName())
                || "reactor.core.publisher.Flux".equals(rawClass.getName());
    }
}
