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
import com.github.xiaoymin.knife4j.annotations.ApiSupport;
import com.github.xiaoymin.knife4j.core.conf.ExtensionsConstants;
import com.github.xiaoymin.knife4j.core.conf.GlobalConstants;
import com.github.xiaoymin.knife4j.spring.configuration.Knife4jProperties;
import com.github.xiaoymin.knife4j.spring.configuration.Knife4jSetting;
import io.swagger.v3.oas.annotations.tags.Tag;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.PathItem;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.ArrayUtils;
import org.springdoc.core.customizers.GlobalOpenApiCustomizer;
import org.springdoc.core.properties.SpringDocConfigProperties;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.type.filter.AnnotationTypeFilter;
import org.springframework.util.CollectionUtils;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

import java.lang.annotation.Annotation;
import java.lang.reflect.Method;
import java.util.*;
import java.util.stream.Collectors;

/**
 * 增强扩展属性支持
 * @since 4.1.0
 * @author <a href="xiaoymin@foxmail.com">xiaoymin@foxmail.com</a>
 * 2022/12/11 22:40
 */
@Slf4j
public class Knife4jOpenApiCustomizer implements GlobalOpenApiCustomizer {

    final Knife4jProperties knife4jProperties;
    final SpringDocConfigProperties properties;
    /** Optional — may be null when not running in a servlet context (e.g. reactive). */
    final RequestMappingHandlerMapping requestMappingHandlerMapping;

    public Knife4jOpenApiCustomizer(Knife4jProperties knife4jProperties,
                                    SpringDocConfigProperties properties,
                                    RequestMappingHandlerMapping requestMappingHandlerMapping) {
        this.knife4jProperties = knife4jProperties;
        this.properties = properties;
        this.requestMappingHandlerMapping = requestMappingHandlerMapping;
    }

    /** Backwards-compatible constructor for callers that don't supply the mapping. */
    public Knife4jOpenApiCustomizer(Knife4jProperties knife4jProperties,
                                    SpringDocConfigProperties properties) {
        this(knife4jProperties, properties, null);
    }

    @Override
    public void customise(OpenAPI openApi) {
        log.debug("Knife4j OpenApiCustomizer");
        if (knife4jProperties.isEnable()) {
            Knife4jSetting setting = knife4jProperties.getSetting();
            OpenApiExtensionResolver openApiExtensionResolver = new OpenApiExtensionResolver(setting, knife4jProperties.getDocuments());
            // 解析初始化
            openApiExtensionResolver.start();
            Map<String, Object> objectMap = new HashMap<>();
            objectMap.put(GlobalConstants.EXTENSION_OPEN_SETTING_NAME, setting);
            objectMap.put(GlobalConstants.EXTENSION_OPEN_MARKDOWN_NAME, openApiExtensionResolver.getMarkdownFiles());
            openApi.addExtension(GlobalConstants.EXTENSION_OPEN_API_NAME, objectMap);
            addOrderExtension(openApi);
        }
    }

    /**
     * 往OpenAPI内tags字段添加x-order属性，并为每个Operation添加x-order属性
     */
    private void addOrderExtension(OpenAPI openApi) {
        Set<String> packagesToScan = resolvePackagesToScan();
        Set<Class<?>> controllers = resolveControllerClasses(packagesToScan);
        applyTagOrder(openApi, controllers);
        applyOperationOrder(openApi, controllers);
    }

    /**
     * Resolve the effective set of packages to scan for @ApiSupport controllers.
     * Priority: knife4j.setting.api-order-package-scan > springdoc packagesToScan > reflection fallback.
     */
    private Set<String> resolvePackagesToScan() {
        Knife4jSetting setting = knife4jProperties.getSetting();
        // 1. Explicit user config takes highest priority
        if (setting != null && !CollectionUtils.isEmpty(setting.getApiOrderPackageScan())) {
            return new HashSet<>(setting.getApiOrderPackageScan());
        }
        // 2. springdoc group packagesToScan
        if (!CollectionUtils.isEmpty(properties.getGroupConfigs())) {
            Set<String> fromGroups = properties.getGroupConfigs().stream()
                    .map(SpringDocConfigProperties.GroupConfig::getPackagesToScan)
                    .filter(toScan -> !CollectionUtils.isEmpty(toScan))
                    .flatMap(List::stream)
                    .collect(Collectors.toSet());
            if (!CollectionUtils.isEmpty(fromGroups)) {
                return fromGroups;
            }
        }
        // 3. Reflection fallback via RequestMappingHandlerMapping
        return Collections.emptySet();
    }

    /**
     * Collect controller classes that carry @ApiSupport.
     * When packagesToScan is empty, fall back to RequestMappingHandlerMapping.
     */
    private Set<Class<?>> resolveControllerClasses(Set<String> packagesToScan) {
        if (!CollectionUtils.isEmpty(packagesToScan)) {
            return packagesToScan.stream()
                    .map(pkg -> scanPackageByAnnotation(pkg, RestController.class))
                    .flatMap(Set::stream)
                    .filter(clazz -> clazz.isAnnotationPresent(ApiSupport.class))
                    .collect(Collectors.toSet());
        }
        // Fallback: inspect handler methods registered in the application context
        if (requestMappingHandlerMapping != null) {
            try {
                return requestMappingHandlerMapping.getHandlerMethods().keySet().stream()
                        .map(info -> requestMappingHandlerMapping.getHandlerMethods().get(info).getBeanType())
                        .filter(clazz -> clazz.isAnnotationPresent(ApiSupport.class))
                        .collect(Collectors.toSet());
            } catch (Exception e) {
                log.warn("Knife4j: failed to collect controllers via RequestMappingHandlerMapping", e);
            }
        }
        return Collections.emptySet();
    }

    /**
     * Apply x-order to OpenAPI tags based on @ApiSupport.order on controller classes.
     */
    private void applyTagOrder(OpenAPI openApi, Set<Class<?>> controllers) {
        if (CollectionUtils.isEmpty(controllers) || openApi.getTags() == null) {
            return;
        }
        Map<String, Integer> tagOrderMap = new HashMap<>();
        controllers.forEach(clazz -> {
            Tag tag = getTag(clazz);
            if (tag != null) {
                ApiSupport apiSupport = clazz.getAnnotation(ApiSupport.class);
                tagOrderMap.putIfAbsent(tag.name(), apiSupport.order());
            }
        });
        openApi.getTags().forEach(tag -> {
            if (tagOrderMap.containsKey(tag.getName())) {
                tag.addExtension(ExtensionsConstants.EXTENSION_ORDER, tagOrderMap.get(tag.getName()));
            }
        });
    }

    /**
     * Apply x-order to each Operation based on @ApiOperationSupport.order on handler methods.
     */
    private void applyOperationOrder(OpenAPI openApi, Set<Class<?>> controllers) {
        if (openApi.getPaths() == null || CollectionUtils.isEmpty(controllers)) {
            return;
        }
        // Build a map: operationId -> order value, derived from @ApiOperationSupport on methods
        Map<String, Integer> operationOrderMap = new HashMap<>();
        for (Class<?> clazz : controllers) {
            for (Method method : clazz.getMethods()) {
                ApiOperationSupport support = method.getAnnotation(ApiOperationSupport.class);
                if (support != null && support.order() != 0) {
                    // springdoc uses method name as operationId by default; also try explicit id
                    operationOrderMap.put(method.getName(), support.order());
                }
            }
        }
        if (operationOrderMap.isEmpty()) {
            return;
        }
        openApi.getPaths().forEach((path, pathItem) -> {
            for (Operation operation : collectOperations(pathItem)) {
                if (operation != null && operation.getOperationId() != null) {
                    Integer order = operationOrderMap.get(operation.getOperationId());
                    if (order != null) {
                        operation.addExtension(ExtensionsConstants.EXTENSION_ORDER, order);
                    }
                }
            }
        });
    }

    private List<Operation> collectOperations(PathItem pathItem) {
        List<Operation> ops = new ArrayList<>();
        if (pathItem.getGet() != null)
            ops.add(pathItem.getGet());
        if (pathItem.getPost() != null)
            ops.add(pathItem.getPost());
        if (pathItem.getPut() != null)
            ops.add(pathItem.getPut());
        if (pathItem.getDelete() != null)
            ops.add(pathItem.getDelete());
        if (pathItem.getPatch() != null)
            ops.add(pathItem.getPatch());
        if (pathItem.getOptions() != null)
            ops.add(pathItem.getOptions());
        if (pathItem.getHead() != null)
            ops.add(pathItem.getHead());
        if (pathItem.getTrace() != null)
            ops.add(pathItem.getTrace());
        return ops;
    }

    private Tag getTag(Class<?> clazz) {
        // 从类上获取
        Tag tag = clazz.getAnnotation(Tag.class);
        if (Objects.isNull(tag)) {
            // 从接口上获取
            Class<?>[] interfaces = clazz.getInterfaces();
            if (ArrayUtils.isNotEmpty(interfaces)) {
                for (Class<?> interfaceClazz : interfaces) {
                    Tag anno = interfaceClazz.getAnnotation(Tag.class);
                    if (Objects.nonNull(anno)) {
                        tag = anno;
                        break;
                    }
                }
            }
        }
        return tag;
    }

    private Set<Class<?>> scanPackageByAnnotation(String packageName,
                                                  final Class<? extends Annotation> annotationClass) {
        ClassPathScanningCandidateComponentProvider scanner =
                new ClassPathScanningCandidateComponentProvider(false);
        scanner.addIncludeFilter(new AnnotationTypeFilter(annotationClass));
        Set<Class<?>> classes = new HashSet<>();
        for (BeanDefinition beanDefinition : scanner.findCandidateComponents(packageName)) {
            try {
                Class<?> clazz = Class.forName(beanDefinition.getBeanClassName());
                classes.add(clazz);
            } catch (ClassNotFoundException ignore) {
            }
        }
        return classes;
    }
}
