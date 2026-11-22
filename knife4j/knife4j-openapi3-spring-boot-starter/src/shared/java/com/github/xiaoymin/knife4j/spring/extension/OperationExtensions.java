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
import com.github.xiaoymin.knife4j.core.util.StrUtil;
import com.github.xiaoymin.knife4j.core.util.ValidationGroupsUtils;
import com.github.xiaoymin.knife4j.extend.util.ExtensionUtils;
import io.swagger.v3.oas.models.Operation;
import org.springframework.core.annotation.AnnotationUtils;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.method.HandlerMethod;

import java.lang.reflect.Parameter;
import java.lang.reflect.Type;
import java.util.List;
import java.util.Map;

final class OperationExtensions {

    private OperationExtensions() {
    }

    static void apply(Operation operation, HandlerMethod handlerMethod, Class<?> beanType) {
        // 解析支持作者、接口排序
        // https://gitee.com/xiaoym/knife4j/issues/I6FB9I
        ApiOperationSupport operationSupport = AnnotationUtils.findAnnotation(handlerMethod.getMethod(), ApiOperationSupport.class);
        if (operationSupport != null) {
            String author = ExtensionUtils.getAuthors(operationSupport);
            if (StrUtil.isNotBlank(author)) {
                operation.addExtension(ExtensionsConstants.EXTENSION_AUTHOR, author);
            }
            if (operationSupport.order() != 0) {
                operation.addExtension(ExtensionsConstants.EXTENSION_ORDER, operationSupport.order());
            }
        } else {
            // 如果方法级别不存在，再找一次class级别的
            ApiSupport apiSupport = AnnotationUtils.findAnnotation(beanType, ApiSupport.class);
            if (apiSupport != null) {
                String author = ExtensionUtils.getAuthor(apiSupport);
                if (StrUtil.isNotBlank(author)) {
                    operation.addExtension(ExtensionsConstants.EXTENSION_AUTHOR, author);
                }
                if (apiSupport.order() != 0) {
                    operation.addExtension(ExtensionsConstants.EXTENSION_ORDER, apiSupport.order());
                }
            }
        }
        applyValidationGroupsExtension(operation, handlerMethod, operationSupport);
    }

    private static void applyValidationGroupsExtension(
                                                       Operation operation,
                                                       HandlerMethod handlerMethod,
                                                       ApiOperationSupport operationSupport) {
        Class<?>[] groups = operationSupport == null ? null : operationSupport.validationGroups();
        Type bodyType = null;
        Parameter[] params = handlerMethod.getMethod().getParameters();
        for (Parameter p : params) {
            if (p.isAnnotationPresent(RequestBody.class)) {
                bodyType = p.getParameterizedType();
                if (groups == null || groups.length == 0) {
                    Validated validated = p.getAnnotation(Validated.class);
                    if (validated != null) {
                        groups = validated.value();
                    }
                }
                break;
            }
        }
        if (bodyType == null || groups == null || groups.length == 0) {
            return;
        }
        Class<?> bodyModelClass = ValidationGroupsUtils.resolveRequestBodyModelClass(bodyType);
        Map<String, List<String>> groupMap = ValidationGroupsUtils.resolveRequiredFields(bodyModelClass, groups);
        if (!groupMap.isEmpty()) {
            operation.addExtension(ExtensionsConstants.EXTENSION_VALIDATION_GROUPS, groupMap);
        }
        Map<String, Map<String, Object>> fieldConstraints =
                ValidationGroupsUtils.resolveFieldSchemaExtensions(bodyModelClass);
        if (!fieldConstraints.isEmpty()) {
            operation.addExtension(ExtensionsConstants.EXTENSION_FIELD_CONSTRAINTS, fieldConstraints);
        }
    }
}
