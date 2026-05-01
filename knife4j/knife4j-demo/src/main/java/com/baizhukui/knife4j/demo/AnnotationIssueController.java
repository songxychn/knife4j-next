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

import com.baizhukui.knife4j.demo.dto.AnnotationIssueDTO;
import com.baizhukui.knife4j.demo.dto.GetQueryObject;
import com.baizhukui.knife4j.demo.dto.UserVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springdoc.core.annotations.ParameterObject;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Reproduction controller for upstream annotation / parameter parsing issues.
 *
 * <ul>
 *   <li>#717 — {@code ResponseBodyAdvice<T>} unified return: entity field descriptions not shown</li>
 *   <li>#675 — single lowercase camel field {@code @Schema} not effective</li>
 *   <li>#745 — {@code @ApiResponse} defined Response Content not displayed</li>
 *   <li>#743 — {@code @JsonView} per-view field visibility</li>
 *   <li>#767 — object as GET parameter not expanded into individual params</li>
 * </ul>
 *
 * <p>Note: #746 ({@code @ApiOperationSupport(ignoreParameters)}) and
 * #887 ({@code @RestControllerAdvice}) require knife4j-openapi2 (Swagger 2) and
 * are not reproducible in this OAS3 demo. They are marked as planned in the triage doc.
 */
@Tag(name = "注解解析复现（#717 #675 #745 #743 #767）", description = "复现 upstream 注解解析、参数展开相关 issue")
@RestController
@RequestMapping("/api/issue/annotation")
public class AnnotationIssueController {

    /**
     * Issue #675: single lowercase camel field.
     * Expected: {@code iCode} and {@code eTag} fields show their {@code @Schema} descriptions.
     * Actual (upstream): springdoc may not match the getter to the field, so description is blank.
     */
    @Operation(summary = "#675 单小写字母驼峰字段 @Schema", description = "返回含 iCode/eTag 字段的 DTO，验证单小写字母驼峰字段的 @Schema 描述是否显示")
    @GetMapping("/camel-field")
    public AnnotationIssueDTO camelField() {
        AnnotationIssueDTO dto = new AnnotationIssueDTO();
        dto.setiCode("A001");
        dto.seteTag("etag-value");
        dto.setAlwaysVisible("always");
        return dto;
    }

    /**
     * Issue #743: @JsonView per-view field visibility.
     * Expected: when the endpoint declares a JsonView, only fields annotated with
     * that view (or no view) should appear in the schema.
     */
    @Operation(summary = "#743 @JsonView 视图字段过滤", description = "返回含 @JsonView 注解字段的 DTO，验证视图过滤是否在文档中正确体现")
    @GetMapping("/json-view")
    public AnnotationIssueDTO jsonView() {
        AnnotationIssueDTO dto = new AnnotationIssueDTO();
        dto.setPublicField("public-data");
        dto.setInternalField("internal-data");
        dto.setAlwaysVisible("always");
        return dto;
    }

    /**
     * Issue #745: @ApiResponse defined Response Content.
     * Expected: the 200 response schema shows UserVO with all field descriptions.
     * Actual (upstream): the content defined in @ApiResponse may not be rendered.
     */
    @Operation(summary = "#745 @ApiResponse 显式 Content 定义", description = "通过 @ApiResponse 显式声明响应 Content，验证是否正确展示")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "成功", content = @Content(schema = @Schema(implementation = UserVO.class))),
            @ApiResponse(responseCode = "400", description = "参数错误", content = @Content(schema = @Schema(description = "错误信息")))
    })
    @GetMapping("/api-response-content")
    public UserVO apiResponseContent() {
        return new UserVO(1L, "张三", "zhangsan@example.com");
    }

    /**
     * Issue #767: object as GET parameter.
     * Using {@code @ParameterObject} (springdoc annotation) should expand the object
     * into individual query parameters. Without it, springdoc renders it as a single
     * opaque body parameter.
     * Expected: keyword, status, sortField, sortOrder appear as separate query params.
     */
    @Operation(summary = "#767 对象作为 GET 参数展开", description = "使用 @ParameterObject 将对象展开为单个 GET 参数，验证是否正确展开")
    @GetMapping("/get-object-param")
    public List<UserVO> getObjectParam(@ParameterObject GetQueryObject query) {
        return List.of(new UserVO(1L, "张三", "zhangsan@example.com"));
    }

    /**
     * Issue #767 (negative case): same object WITHOUT @ParameterObject.
     * Expected: springdoc renders it as a request body (incorrect for GET).
     * This demonstrates the difference.
     */
    @Operation(summary = "#767 对象作为 GET 参数（无 @ParameterObject，对照组）", description = "不使用 @ParameterObject，对照验证参数是否被错误渲染为 body")
    @GetMapping("/get-object-param-no-expand")
    public List<UserVO> getObjectParamNoExpand(GetQueryObject query) {
        return List.of(new UserVO(1L, "张三", "zhangsan@example.com"));
    }

    /**
     * Issue #717: ResponseBodyAdvice unified return — entity field descriptions.
     * This endpoint simulates a controller whose actual return type is wrapped by
     * a ResponseBodyAdvice. The declared return type is UserVO, but at runtime
     * it would be wrapped in a GenericWrapper by the advice.
     * Expected: UserVO field descriptions are visible in the schema.
     * Actual (upstream): when ResponseBodyAdvice wraps the response, field descriptions
     * from the original entity may not appear.
     */
    @Operation(summary = "#717 ResponseBodyAdvice 统一返回实体字段说明", description = "模拟 ResponseBodyAdvice 包装场景，验证实体类属性说明是否显示（实际运行时由 advice 包装）")
    @PostMapping("/advice-wrapped")
    public UserVO adviceWrapped(@RequestBody UserVO user) {
        return user;
    }
}
