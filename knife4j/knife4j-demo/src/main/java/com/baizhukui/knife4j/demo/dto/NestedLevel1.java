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
 * Level-1 nesting — reproduces upstream issues #677 #649.
 * <p>
 * Issue #677: multi-level nested docs not shown.
 * Issue #649: {@code @Schema(title)} not shown beyond 3 nesting levels.
 */
@Schema(description = "一级嵌套对象（#677 #649）")
public class NestedLevel1 {

    @Schema(description = "一级字段", example = "level1-value")
    private String level1Field;

    @Schema(description = "二级嵌套对象")
    private NestedLevel2 nested;

    public NestedLevel1() {
    }

    public String getLevel1Field() {
        return level1Field;
    }
    public void setLevel1Field(String level1Field) {
        this.level1Field = level1Field;
    }

    public NestedLevel2 getNested() {
        return nested;
    }
    public void setNested(NestedLevel2 nested) {
        this.nested = nested;
    }
}
