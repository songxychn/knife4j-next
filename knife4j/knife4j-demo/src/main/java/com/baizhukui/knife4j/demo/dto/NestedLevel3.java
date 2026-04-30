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
 * Level-3 nesting — reproduces upstream issue #649.
 * <p>
 * Issue #649: {@code @Schema(title)} not shown when nesting exceeds 3 levels.
 * This is the 3rd level; the title annotation here should still be visible.
 */
@Schema(title = "三级嵌套标题（#649）", description = "三级嵌套对象")
public class NestedLevel3 {

    @Schema(description = "三级字段", example = "level3-value")
    private String level3Field;

    /**
     * Issue #649: 4th-level nesting — @Schema(title) may not appear.
     */
    @Schema(description = "四级嵌套对象（#649: 超过三层后 title 不显示）")
    private NestedLevel4 nested;

    public NestedLevel3() {
    }

    public String getLevel3Field() {
        return level3Field;
    }
    public void setLevel3Field(String level3Field) {
        this.level3Field = level3Field;
    }

    public NestedLevel4 getNested() {
        return nested;
    }
    public void setNested(NestedLevel4 nested) {
        this.nested = nested;
    }
}
