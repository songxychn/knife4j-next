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

@Schema(description = "分页查询参数")
public class PageQuery {

    @Schema(description = "页码（从 1 开始）", example = "1", requiredMode = Schema.RequiredMode.NOT_REQUIRED)
    private int pageNum = 1;

    @Schema(description = "每页条数", example = "10", requiredMode = Schema.RequiredMode.NOT_REQUIRED)
    private int pageSize = 10;

    @Schema(description = "关键词（模糊搜索用户名或邮箱）", example = "张", requiredMode = Schema.RequiredMode.NOT_REQUIRED)
    private String keyword;

    public PageQuery() {
    }

    public int getPageNum() {
        return pageNum;
    }
    public void setPageNum(int pageNum) {
        this.pageNum = pageNum;
    }

    public int getPageSize() {
        return pageSize;
    }
    public void setPageSize(int pageSize) {
        this.pageSize = pageSize;
    }

    public String getKeyword() {
        return keyword;
    }
    public void setKeyword(String keyword) {
        this.keyword = keyword;
    }
}
