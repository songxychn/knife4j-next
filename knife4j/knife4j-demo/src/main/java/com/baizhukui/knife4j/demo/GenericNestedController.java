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

import com.baizhukui.knife4j.demo.dto.GenericWrapper;
import com.baizhukui.knife4j.demo.dto.NestedLevel1;
import com.baizhukui.knife4j.demo.dto.NestedLevel2;
import com.baizhukui.knife4j.demo.dto.NestedLevel3;
import com.baizhukui.knife4j.demo.dto.NestedLevel4;
import com.baizhukui.knife4j.demo.dto.UserVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Reproduction controller for upstream generic / nested / $ref issues.
 *
 * <ul>
 *   <li>#683 — generic display problem (rendering incorrect)</li>
 *   <li>#826 — {@code @Schema} on generic field not effective</li>
 *   <li>#677 — multi-level nested docs not shown</li>
 *   <li>#649 — {@code @Schema(title)} not shown beyond 3 nesting levels</li>
 *   <li>#757 — {@code $ref} value not correctly displayed in response</li>
 * </ul>
 *
 * <p>Verification: start the demo app and open doc.html, navigate to this tag.
 * For each endpoint, check that:
 * <ol>
 *   <li>#683/#826: the {@code data} field in the response schema shows its description.</li>
 *   <li>#677: all four nesting levels appear in the schema tree.</li>
 *   <li>#649: the {@code title} attribute on {@link NestedLevel3} and {@link NestedLevel4}
 *       is visible in the rendered schema.</li>
 *   <li>#757: the response schema uses {@code $ref} correctly and the referenced model
 *       is fully expanded.</li>
 * </ol>
 */
@Tag(name = "泛型/嵌套/$ref 复现（#683 #826 #677 #649 #757）", description = "复现 upstream 泛型展示、嵌套文档、$ref 相关 issue")
@RestController
@RequestMapping("/api/issue/generic")
public class GenericNestedController {

    /**
     * Issue #683 / #826: generic wrapper with a simple VO.
     * Expected: {@code data} field description "泛型数据体" is visible in the schema.
     */
    @Operation(summary = "#683/#826 泛型包装 UserVO", description = "返回 GenericWrapper<UserVO>，验证泛型字段 @Schema 是否生效")
    @GetMapping("/wrapped-user")
    public GenericWrapper<UserVO> wrappedUser() {
        return new GenericWrapper<>(200, "success",
                new UserVO(1L, "张三", "zhangsan@example.com"));
    }

    /**
     * Issue #683 / #826: generic wrapper with a List.
     * Expected: {@code data} field resolves to an array of UserVO with descriptions.
     */
    @Operation(summary = "#683/#826 泛型包装 List<UserVO>", description = "返回 GenericWrapper<List<UserVO>>，验证泛型列表字段 @Schema 是否生效")
    @GetMapping("/wrapped-list")
    public GenericWrapper<List<UserVO>> wrappedList() {
        return new GenericWrapper<>(200, "success",
                List.of(new UserVO(1L, "张三", "zhangsan@example.com")));
    }

    /**
     * Issue #677 / #649: 4-level deep nesting.
     * Expected: all four levels appear in the schema tree with their descriptions.
     * For #649: the {@code title} on NestedLevel3 and NestedLevel4 should be visible.
     */
    @Operation(summary = "#677/#649 四层嵌套对象", description = "返回四层嵌套 DTO，验证多层嵌套文档是否全部显示，以及超过三层后 @Schema(title) 是否仍然可见")
    @GetMapping("/deep-nested")
    public NestedLevel1 deepNested() {
        NestedLevel4 l4 = new NestedLevel4();
        l4.setLevel4Field("level4-value");
        NestedLevel3 l3 = new NestedLevel3();
        l3.setLevel3Field("level3-value");
        l3.setNested(l4);
        NestedLevel2 l2 = new NestedLevel2();
        l2.setLevel2Field("level2-value");
        l2.setNested(l3);
        NestedLevel1 l1 = new NestedLevel1();
        l1.setLevel1Field("level1-value");
        l1.setNested(l2);
        return l1;
    }

    /**
     * Issue #757: explicit @ApiResponse with $ref-style schema.
     * Expected: the response content schema correctly resolves the $ref to UserVO
     * and displays all its fields.
     */
    @Operation(summary = "#757 @ApiResponse 显式 $ref", description = "通过 @ApiResponse 显式声明响应 schema，验证 $ref 是否正确展开")
    @ApiResponse(responseCode = "200", description = "成功", content = @Content(schema = @Schema(implementation = UserVO.class)))
    @GetMapping("/explicit-ref")
    public UserVO explicitRef() {
        return new UserVO(1L, "张三", "zhangsan@example.com");
    }

    /**
     * Issue #812: List<List<Object>> 2D structure.
     * Expected: the response schema shows a 2D array (array of arrays).
     */
    @Operation(summary = "#812 二维 List<List<String>>", description = "返回二维列表，验证 List<List<Object>> 结构是否正确解析")
    @GetMapping("/2d-list")
    public List<List<String>> twoDimensionalList() {
        return List.of(
                List.of("a1", "a2"),
                List.of("b1", "b2"));
    }
}
