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

import com.github.xiaoymin.knife4j.annotations.ApiOperationSupport;
import com.baizhukui.knife4j.demo.validation.Create;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Demonstrates knife4j's {@code x-field-constraints} extension (issue #118).
 *
 * <p>The {@link RegisterRequest} DTO carries standard Bean Validation constraints
 * ({@code @Email}, {@code @Pattern}, {@code @Size}). knife4j resolves these via
 * {@code Knife4jValidatorAnnotationResolver} and emits an {@code x-field-constraints}
 * extension on the operation, e.g.:
 *
 * <pre>
 * x-field-constraints:
 *   email:
 *     format: email
 *   phone:
 *     pattern: "^1[3-9]\\d{9}$"
 *   username:
 *     minLength: 3
 *     maxLength: 20
 *   password:
 *     minLength: 8
 *     maxLength: 32
 * </pre>
 *
 * <p>Custom resolvers can be registered via ServiceLoader or Spring {@code @Bean}
 * to handle application-specific constraint annotations.
 */
@Tag(name = "Validator SPI 示例", description = "演示 x-field-constraints 扩展（issue #118）")
@RestController
@RequestMapping("/api/validator-spi-demo")
public class ValidatorSpiDemoController {

    /**
     * 注册用户 — 演示 @Email/@Pattern/@Size 约束被解析为 x-field-constraints。
     */
    @Operation(summary = "注册用户（演示字段约束扩展）")
    @ApiOperationSupport(order = 1, validationGroups = {Create.class})
    @PostMapping("/register")
    public String register(@RequestBody RegisterRequest request) {
        return "registered: " + request.getUsername();
    }

    /**
     * Request DTO carrying Bean Validation constraints that knife4j resolves
     * into OpenAPI schema increments via the validator SPI.
     */
    @Schema(description = "注册请求（演示 x-field-constraints 扩展）")
    public static class RegisterRequest {

        @Schema(description = "用户名（3-20 个字符）", example = "alice")
        @NotBlank
        @Size(min = 3, max = 20)
        private String username;

        @Schema(description = "邮箱地址", example = "alice@example.com")
        @NotBlank
        @Email
        private String email;

        @Schema(description = "手机号（11 位数字）", example = "13800138000")
        @Pattern(regexp = "^1[3-9]\\d{9}$")
        private String phone;

        @Schema(description = "密码（8-32 个字符）", example = "P@ssw0rd!")
        @NotBlank
        @Size(min = 8, max = 32)
        private String password;

        public RegisterRequest() {
        }

        public String getUsername() {
            return username;
        }

        public void setUsername(String username) {
            this.username = username;
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

        public String getPassword() {
            return password;
        }

        public void setPassword(String password) {
            this.password = password;
        }
    }
}
