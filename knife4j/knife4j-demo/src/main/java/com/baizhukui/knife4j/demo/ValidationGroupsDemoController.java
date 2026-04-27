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


package com.baizhukui.knife4j.demo;

import com.baizhukui.knife4j.demo.dto.UserFormRequest;
import com.baizhukui.knife4j.demo.dto.UserVO;
import com.baizhukui.knife4j.demo.validation.Create;
import com.baizhukui.knife4j.demo.validation.Update;
import com.github.xiaoymin.knife4j.annotations.ApiOperationSupport;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

/**
 * Demonstrates knife4j's {@code x-validation-groups} extension.
 *
 * <p>Both endpoints share the same {@link UserFormRequest} DTO but declare
 * different {@code validationGroups} via {@link ApiOperationSupport}.
 * knife4j will emit an {@code x-validation-groups} extension on each operation
 * listing which fields are required for that specific group.
 *
 * <p>Expected {@code x-validation-groups} output:
 * <ul>
 *   <li>POST /api/validation-demo/user → {@code {"Create": ["name", "email"]}}</li>
 *   <li>PUT  /api/validation-demo/user → {@code {"Update": ["id", "name"]}}</li>
 * </ul>
 */
@Tag(name = "Validation Groups 示例", description = "演示 @Validation groups 按分组输出不同 required 集合")
@RestController
@RequestMapping("/api/validation-demo")
public class ValidationGroupsDemoController {

    /**
     * 创建用户 — 使用 Create 分组校验。
     * 必填字段：name, email（id 和 phone 可选）。
     */
    @Operation(summary = "创建用户（Create 分组）")
    @ApiOperationSupport(order = 1, validationGroups = {Create.class})
    @PostMapping("/user")
    public UserVO create(@RequestBody @Validated(Create.class) UserFormRequest request) {
        return new UserVO(1L, request.getName(), request.getEmail());
    }

    /**
     * 更新用户 — 使用 Update 分组校验。
     * 必填字段：id, name（email 和 phone 可选）。
     */
    @Operation(summary = "更新用户（Update 分组）")
    @ApiOperationSupport(order = 2, validationGroups = {Update.class})
    @PutMapping("/user")
    public UserVO update(@RequestBody @Validated(Update.class) UserFormRequest request) {
        return new UserVO(request.getId(), request.getName(), request.getEmail());
    }
}
