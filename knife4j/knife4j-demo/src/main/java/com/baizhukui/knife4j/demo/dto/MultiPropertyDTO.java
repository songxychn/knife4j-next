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
 * DTO with multiple properties — reproduces upstream "field not shown" issues.
 *
 * <ul>
 *   <li>#828 — fields not shown in interface</li>
 *   <li>#754 — multiple object properties not displayed</li>
 *   <li>#911 — entity-received parameter interface doc display anomaly</li>
 *   <li>#895 — interface doc display incorrect</li>
 *   <li>#889 — knife4j generated doc differs from swagger doc</li>
 * </ul>
 */
@Schema(description = "多属性实体（#828 #754 #911 #895 #889）")
public class MultiPropertyDTO {

    @Schema(description = "主键 ID", example = "1")
    private Long id;

    @Schema(description = "名称", example = "示例名称")
    private String name;

    @Schema(description = "描述", example = "这是一段描述")
    private String description;

    @Schema(description = "状态（0=禁用 1=启用）", example = "1")
    private Integer status;

    @Schema(description = "排序权重", example = "100")
    private Integer sortOrder;

    @Schema(description = "创建时间（毫秒时间戳）", example = "1700000000000")
    private Long createTime;

    @Schema(description = "更新时间（毫秒时间戳）", example = "1700000000000")
    private Long updateTime;

    @Schema(description = "扩展字段1", example = "ext1-value")
    private String ext1;

    @Schema(description = "扩展字段2", example = "ext2-value")
    private String ext2;

    public MultiPropertyDTO() {
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

    public String getDescription() {
        return description;
    }
    public void setDescription(String description) {
        this.description = description;
    }

    public Integer getStatus() {
        return status;
    }
    public void setStatus(Integer status) {
        this.status = status;
    }

    public Integer getSortOrder() {
        return sortOrder;
    }
    public void setSortOrder(Integer sortOrder) {
        this.sortOrder = sortOrder;
    }

    public Long getCreateTime() {
        return createTime;
    }
    public void setCreateTime(Long createTime) {
        this.createTime = createTime;
    }

    public Long getUpdateTime() {
        return updateTime;
    }
    public void setUpdateTime(Long updateTime) {
        this.updateTime = updateTime;
    }

    public String getExt1() {
        return ext1;
    }
    public void setExt1(String ext1) {
        this.ext1 = ext1;
    }

    public String getExt2() {
        return ext2;
    }
    public void setExt2(String ext2) {
        this.ext2 = ext2;
    }
}
