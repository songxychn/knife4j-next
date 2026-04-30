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

import com.baizhukui.knife4j.demo.dto.MultiPropertyDTO;
import com.baizhukui.knife4j.demo.dto.UserVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Reproduction controller for upstream "field not shown" issues.
 *
 * <ul>
 *   <li>#828 — fields not shown in interface</li>
 *   <li>#754 — multiple object properties not displayed</li>
 *   <li>#911 — entity-received parameter interface doc display anomaly</li>
 *   <li>#895 — interface doc display incorrect</li>
 *   <li>#889 — knife4j generated doc differs from swagger doc</li>
 * </ul>
 *
 * <p>Verification: start the demo app and open doc.html, navigate to this tag.
 * For each endpoint, verify that ALL declared fields appear in the schema with
 * their descriptions. If any field is missing, the upstream issue is reproduced.
 */
@Tag(name = "字段不显示复现（#828 #754 #911 #895 #889）",
        description = "复现 upstream 字段不显示、文档展示异常相关 issue")
@RestController
@RequestMapping("/api/issue/fields")
public class FieldNotShownController {

    /**
     * Issue #754 / #828: multiple object properties.
     * Expected: all 9 fields of MultiPropertyDTO appear in the response schema.
     */
    @Operation(summary = "#754/#828 多属性对象返回",
            description = "返回含多个属性的 DTO，验证所有字段是否全部显示")
    @GetMapping("/multi-property")
    public MultiPropertyDTO multiProperty() {
        MultiPropertyDTO dto = new MultiPropertyDTO();
        dto.setId(1L);
        dto.setName("示例");
        dto.setDescription("这是描述");
        dto.setStatus(1);
        dto.setSortOrder(100);
        dto.setCreateTime(1700000000000L);
        dto.setUpdateTime(1700000000000L);
        dto.setExt1("ext1");
        dto.setExt2("ext2");
        return dto;
    }

    /**
     * Issue #911: entity as request body parameter.
     * Expected: all fields of MultiPropertyDTO appear in the request body schema.
     */
    @Operation(summary = "#911 实体作为请求体参数",
            description = "用实体接收请求体参数，验证接口文档前端展示是否正常")
    @PostMapping("/entity-param")
    public MultiPropertyDTO entityParam(@RequestBody MultiPropertyDTO dto) {
        return dto;
    }

    /**
     * Issue #895 / #889: list of entities.
     * Expected: the response schema shows an array of UserVO with all field descriptions.
     * Actual (upstream): some fields may be missing or descriptions may differ from
     * what swagger-ui shows.
     */
    @Operation(summary = "#895/#889 实体列表返回",
            description = "返回实体列表，验证文档与 swagger 标准展示是否一致")
    @GetMapping("/entity-list")
    public List<UserVO> entityList() {
        return List.of(
                new UserVO(1L, "张三", "zhangsan@example.com"),
                new UserVO(2L, "李四", "lisi@example.com"));
    }

    /**
     * Issue #828: single entity return.
     * Expected: all fields of UserVO appear in the response schema.
     */
    @Operation(summary = "#828 单实体返回字段显示",
            description = "返回单个实体，验证所有字段是否显示")
    @GetMapping("/single-entity")
    public UserVO singleEntity() {
        return new UserVO(1L, "张三", "zhangsan@example.com");
    }
}
