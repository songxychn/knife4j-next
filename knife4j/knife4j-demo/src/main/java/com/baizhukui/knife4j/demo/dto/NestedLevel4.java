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
 * Level-4 nesting — reproduces upstream issue #649.
 * <p>
 * Issue #649: {@code @Schema(title)} not shown when nesting exceeds 3 levels.
 * The title on this class should be visible in the rendered docs but may not be.
 */
@Schema(title = "四级嵌套标题（#649: 此处 title 可能不显示）", description = "四级嵌套对象")
public class NestedLevel4 {

    @Schema(description = "四级字段", example = "level4-value")
    private String level4Field;

    public NestedLevel4() {}

    public String getLevel4Field() { return level4Field; }
    public void setLevel4Field(String level4Field) { this.level4Field = level4Field; }
}
