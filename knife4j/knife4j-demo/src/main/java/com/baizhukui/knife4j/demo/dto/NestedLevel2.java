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
 * Level-2 nesting — reproduces upstream issues #677 #649.
 */
@Schema(description = "二级嵌套对象（#677 #649）")
public class NestedLevel2 {

    @Schema(description = "二级字段", example = "level2-value")
    private String level2Field;

    @Schema(description = "三级嵌套对象")
    private NestedLevel3 nested;

    public NestedLevel2() {}

    public String getLevel2Field() { return level2Field; }
    public void setLevel2Field(String level2Field) { this.level2Field = level2Field; }

    public NestedLevel3 getNested() { return nested; }
    public void setNested(NestedLevel3 nested) { this.nested = nested; }
}
