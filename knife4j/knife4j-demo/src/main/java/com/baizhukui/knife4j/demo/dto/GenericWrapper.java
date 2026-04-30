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

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * Generic wrapper — reproduces upstream issues #683 #826 #677 #649 #757.
 * <p>
 * Issue #683: generic display problem (rendering incorrect).
 * Issue #826: {@code @Schema} on generic field not effective.
 * Issue #677: multi-level nested docs not shown.
 * Issue #649: {@code @Schema(title)} not shown beyond 3 nesting levels.
 * Issue #757: {@code $ref} value not correctly displayed in response.
 */
@Schema(description = "通用泛型包装器（复现 #683 #826 #677 #649 #757）")
public class GenericWrapper<T> {

    @Schema(description = "业务状态码", example = "200")
    private int code;

    @Schema(description = "提示信息", example = "success")
    private String message;

    /**
     * Issue #826: @Schema on a generic-typed field.
     * springdoc may fail to resolve the description when T is a complex type.
     */
    @Schema(description = "泛型数据体（#826: @Schema 对泛型字段不生效）")
    private T data;

    public GenericWrapper() {}

    public GenericWrapper(int code, String message, T data) {
        this.code = code;
        this.message = message;
        this.data = data;
    }

    public int getCode() { return code; }
    public void setCode(int code) { this.code = code; }

    public String getMessage() { return message; }
    public void setMessage(String message) { this.message = message; }

    public T getData() { return data; }
    public void setData(T data) { this.data = data; }
}
