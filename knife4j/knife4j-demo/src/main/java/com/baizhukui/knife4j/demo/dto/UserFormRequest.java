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


package com.baizhukui.knife4j.demo.dto;

import com.baizhukui.knife4j.demo.validation.Create;
import com.baizhukui.knife4j.demo.validation.Update;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * Shared user form DTO demonstrating @Validation groups.
 *
 * <ul>
 *   <li>{@code name}  — required for both Create and Update</li>
 *   <li>{@code email} — required only for Create</li>
 *   <li>{@code id}    — required only for Update</li>
 * </ul>
 *
 * knife4j emits {@code x-validation-groups} on each operation so the UI can
 * display the correct required-field set per group.
 */
@Schema(description = "用户表单（Create/Update 共用，通过 validation groups 区分必填字段）")
public class UserFormRequest {

    @Schema(description = "用户 ID（更新时必填）", example = "1")
    @NotNull(groups = Update.class)
    private Long id;

    @Schema(description = "用户名（创建和更新时均必填）", example = "张三")
    @NotBlank(groups = {Create.class, Update.class})
    private String name;

    @Schema(description = "邮箱地址（创建时必填）", example = "zhangsan@example.com")
    @NotBlank(groups = Create.class)
    private String email;

    @Schema(description = "手机号（可选）", example = "13800138000")
    private String phone;

    public UserFormRequest() {
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getPhone() {
        return phone;
    }

    public void setPhone(String phone) {
        this.phone = phone;
    }
}
