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

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * Query object for GET parameter expansion — reproduces upstream issue #767.
 * <p>
 * Issue #767: object used as GET parameter should be expanded into individual
 * query parameters, but springdoc may render it as a single opaque object.
 */
@Schema(description = "GET 参数对象（#767: 应展开为单个参数）")
public class GetQueryObject {

    @Schema(description = "关键词", example = "knife4j")
    private String keyword;

    @Schema(description = "状态过滤", example = "1")
    private Integer status;

    @Schema(description = "排序字段", example = "createTime")
    private String sortField;

    @Schema(description = "排序方向", example = "desc", allowableValues = {"asc", "desc"})
    private String sortOrder;

    public GetQueryObject() {
    }

    public String getKeyword() {
        return keyword;
    }
    public void setKeyword(String keyword) {
        this.keyword = keyword;
    }

    public Integer getStatus() {
        return status;
    }
    public void setStatus(Integer status) {
        this.status = status;
    }

    public String getSortField() {
        return sortField;
    }
    public void setSortField(String sortField) {
        this.sortField = sortField;
    }

    public String getSortOrder() {
        return sortOrder;
    }
    public void setSortOrder(String sortOrder) {
        this.sortOrder = sortOrder;
    }
}
