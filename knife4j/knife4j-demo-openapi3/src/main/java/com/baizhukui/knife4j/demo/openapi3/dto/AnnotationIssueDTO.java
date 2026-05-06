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


package com.baizhukui.knife4j.demo.openapi3.dto;

import com.fasterxml.jackson.annotation.JsonView;
import io.swagger.v3.oas.annotations.media.Schema;

/**
 * DTO for annotation parsing reproduction issues.
 *
 * <ul>
 *   <li>#675 — single lowercase camel field {@code @Schema} not effective</li>
 *   <li>#743 — {@code @JsonView} per-view field visibility</li>
 * </ul>
 */
@Schema(description = "注解解析复现 DTO（#675 #743）")
public class AnnotationIssueDTO {

    /** JsonView markers for #743. */
    public interface Views {

        interface Public {
        }
        interface Internal extends Public {
        }
    }

    /**
     * Issue #675: single lowercase camel field.
     * Field name starts with a single lowercase letter followed by uppercase.
     * springdoc may fail to match the getter {@code getiCode()} to this field.
     */
    @Schema(description = "单小写字母驼峰字段（#675: @Schema 可能不生效）", example = "A001")
    private String iCode;

    /**
     * Issue #675: another single-letter prefix field.
     */
    @Schema(description = "单小写字母驼峰字段 eTag（#675）", example = "etag-value")
    private String eTag;

    /**
     * Issue #743: public-view field — visible in both Public and Internal views.
     */
    @JsonView(Views.Public.class)
    @Schema(description = "公开字段（#743: @JsonView Public 视图可见）", example = "public-data")
    private String publicField;

    /**
     * Issue #743: internal-only field — visible only in Internal view.
     */
    @JsonView(Views.Internal.class)
    @Schema(description = "内部字段（#743: @JsonView Internal 视图可见）", example = "internal-data")
    private String internalField;

    /**
     * No JsonView — should always be visible.
     */
    @Schema(description = "无视图限制字段（始终可见）", example = "always-visible")
    private String alwaysVisible;

    public AnnotationIssueDTO() {
    }

    public String getiCode() {
        return iCode;
    }
    public void setiCode(String iCode) {
        this.iCode = iCode;
    }

    public String geteTag() {
        return eTag;
    }
    public void seteTag(String eTag) {
        this.eTag = eTag;
    }

    public String getPublicField() {
        return publicField;
    }
    public void setPublicField(String publicField) {
        this.publicField = publicField;
    }

    public String getInternalField() {
        return internalField;
    }
    public void setInternalField(String internalField) {
        this.internalField = internalField;
    }

    public String getAlwaysVisible() {
        return alwaysVisible;
    }
    public void setAlwaysVisible(String alwaysVisible) {
        this.alwaysVisible = alwaysVisible;
    }
}
